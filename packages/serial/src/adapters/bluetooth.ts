import type {
  AdapterSerialPort,
  SerialAdapter,
  SerialPortInfo,
} from "./serial-adapter"
import {
  V5SerialConnection,
  type VexSerialConnectionOptions,
} from "../vex/vex-connection"
import { TailQueue } from "../vex/tail-queue"

// UUIDs and pairing protocol from vexide/vex-v5-serial's bluetooth transport.
export const V5_BLUETOOTH_SERVICE = "08590f7e-db05-467e-8757-72f6faeb13d5"

export const V5_BLUETOOTH_CHARACTERISTICS = {
  systemTx: "08590f7e-db05-467e-8757-72f6faeb1306",
  systemRx: "08590f7e-db05-467e-8757-72f6faeb13f5",
  userTx: "08590f7e-db05-467e-8757-72f6faeb1316",
  userRx: "08590f7e-db05-467e-8757-72f6faeb1326",
  pairing: "08590f7e-db05-467e-8757-72f6faeb13e5",
} as const

export const V5_BLUETOOTH_MAX_PACKET_SIZE = 244

/** Structural Web Bluetooth types, usable without installing ambient DOM types. */
export interface WebBluetoothCharacteristic extends EventTarget {
  readonly value?: DataView
  readValue(): Promise<DataView>
  writeValueWithoutResponse(value: BufferSource): Promise<void>
  startNotifications(): Promise<WebBluetoothCharacteristic>
}

export interface WebBluetoothDevice extends EventTarget {
  readonly id: string
  readonly name?: string
  readonly gatt?: {
    readonly connected: boolean
    connect(): Promise<{
      getPrimaryService(uuid: string): Promise<{
        getCharacteristic(uuid: string): Promise<WebBluetoothCharacteristic>
      }>
    }>
    disconnect(): void
  }
  forget?(): Promise<void>
}

export interface WebBluetooth {
  requestDevice(options: {
    filters: { services: string[] }[]
  }): Promise<WebBluetoothDevice>
  getDevices?(): Promise<WebBluetoothDevice[]>
}

export class BluetoothSerialPort implements AdapterSerialPort {
  readonly maxPacketSize = V5_BLUETOOTH_MAX_PACKET_SIZE
  readonly fileWritesWithoutReply = true
  readable: ReadableStream<Uint8Array> | null = null
  writable: WritableStream<Uint8Array> | null = null
  readonly device: WebBluetoothDevice
  private readonly operations = new TailQueue()
  private readonly disconnectListeners = new Set<() => void>()

  private characteristics:
    | Record<
        keyof typeof V5_BLUETOOTH_CHARACTERISTICS,
        WebBluetoothCharacteristic
      >
    | undefined

  private controller: ReadableStreamDefaultController<Uint8Array> | undefined
  private userData: Uint8Array[] = []

  constructor(device: WebBluetoothDevice) {
    this.device = device
  }

  getInfo(): SerialPortInfo {
    return { path: this.device.id }
  }

  async open(_options: { baudRate: number }): Promise<void> {
    if (this.readable !== null) throw new Error("Already connected.")
    const gatt = this.device.gatt

    if (gatt === undefined)
      throw new Error("Bluetooth device has no GATT server")

    this.device.addEventListener("gattserverdisconnected", this.onDisconnect)

    try {
      const server = await gatt.connect()
      const service = await server.getPrimaryService(V5_BLUETOOTH_SERVICE)
      const characteristics = {} as NonNullable<typeof this.characteristics>

      // Browsers can reject overlapping GATT operations, so discover sequentially.
      for (const key of Object.keys(
        V5_BLUETOOTH_CHARACTERISTICS
      ) as (keyof typeof V5_BLUETOOTH_CHARACTERISTICS)[]) {
        characteristics[key] = await service.getCharacteristic(
          V5_BLUETOOTH_CHARACTERISTICS[key]
        )
      }

      this.characteristics = characteristics

      this.readable = new ReadableStream<Uint8Array>({
        start: (controller) => {
          this.controller = controller
        },
        cancel: () => {
          this.controller = undefined
        },
      })

      this.writable = new WritableStream<Uint8Array>({
        write: (data) =>
          this.operations.run(async () => {
            if (data.byteLength > this.maxPacketSize)
              throw new RangeError(
                "Bluetooth protocol packets must be at most 244 bytes"
              )

            if (!(await this.isPairedUnlocked()))
              throw new Error("Bluetooth pairing is required")

            await this.getCharacteristics().systemRx.writeValueWithoutResponse(
              Uint8Array.from(data)
            )
          }),
      })

      characteristics.systemTx.addEventListener(
        "characteristicvaluechanged",
        this.onSystemData
      )

      characteristics.userTx.addEventListener(
        "characteristicvaluechanged",
        this.onUserData
      )

      await characteristics.systemTx.startNotifications()
      await characteristics.userTx.startNotifications()

      if (!gatt.connected)
        throw new Error("Bluetooth device disconnected while opening")
    } catch (error) {
      await this.close()
      throw error
    }
  }

  private getCharacteristics() {
    if (this.characteristics === undefined || !this.device.gatt?.connected)
      throw new Error("Bluetooth connection is closed")

    return this.characteristics
  }

  private async isPairedUnlocked(): Promise<boolean> {
    const value = await this.getCharacteristics().pairing.readValue()

    if (value.byteLength < 4)
      throw new Error("Invalid Bluetooth pairing response")

    return value.getUint32(0, false) !== 0xdeadface
  }

  isPaired(): Promise<boolean> {
    return this.operations.run(() => this.isPairedUnlocked())
  }

  requestPairing(): Promise<void> {
    return this.operations.run(() =>
      this.getCharacteristics().pairing.writeValueWithoutResponse(
        new Uint8Array([255, 255, 255, 255])
      )
    )
  }

  /** PIN bytes are numeric digits, not ASCII. A string preserves leading zeros. */
  authenticatePairing(pin: string | Uint8Array): Promise<void> {
    const bytes =
      typeof pin === "string" && /^\d{4}$/.test(pin)
        ? Uint8Array.from(pin, (digit) => Number(digit))
        : typeof pin === "string"
          ? new Uint8Array()
          : Uint8Array.from(pin)

    if (bytes.length !== 4 || bytes.some((digit) => digit > 9))
      return Promise.reject(new RangeError("PIN must contain four digits"))

    return this.operations.run(async () => {
      const pairing = this.getCharacteristics().pairing
      await pairing.writeValueWithoutResponse(bytes)
      const value = await pairing.readValue()

      if (
        value.byteLength !== 4 ||
        bytes.some((digit, index) => value.getUint8(index) !== digit)
      )
        throw new Error("Incorrect Bluetooth PIN")
    })
  }

  async readUser(): Promise<Uint8Array> {
    this.getCharacteristics()
    const chunks = this.userData.splice(0)

    const data = new Uint8Array(
      chunks.reduce((size, chunk) => size + chunk.length, 0)
    )

    let offset = 0

    for (const chunk of chunks) {
      data.set(chunk, offset)
      offset += chunk.length
    }

    return data
  }

  writeUser(data: Uint8Array): Promise<number> {
    const bytes = Uint8Array.from(data)

    return this.operations.run(async () => {
      if (!(await this.isPairedUnlocked()))
        throw new Error("Bluetooth pairing is required")

      for (
        let offset = 0;
        offset < bytes.length;
        offset += this.maxPacketSize
      ) {
        await this.getCharacteristics().userRx.writeValueWithoutResponse(
          bytes.slice(offset, offset + this.maxPacketSize)
        )
      }

      return bytes.length
    })
  }

  private notificationBytes(event: Event): Uint8Array | undefined {
    const value = (event.target as WebBluetoothCharacteristic).value

    return value === undefined
      ? undefined
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
  }

  private onSystemData = (event: Event): void => {
    const bytes = this.notificationBytes(event)
    if (bytes !== undefined) this.controller?.enqueue(bytes)
  }

  private onUserData = (event: Event): void => {
    const bytes = this.notificationBytes(event)
    if (bytes !== undefined) this.userData.push(bytes)
  }

  private onDisconnect = (): void => {
    this.clearResources()
    for (const listener of this.disconnectListeners) listener()
  }

  private clearResources(): void {
    this.device.removeEventListener("gattserverdisconnected", this.onDisconnect)

    this.characteristics?.systemTx.removeEventListener(
      "characteristicvaluechanged",
      this.onSystemData
    )

    this.characteristics?.userTx.removeEventListener(
      "characteristicvaluechanged",
      this.onUserData
    )

    this.characteristics = undefined

    try {
      this.controller?.close()
    } catch {}

    this.controller = undefined
    this.userData = []
    this.readable = null
    this.writable = null
  }

  async close(): Promise<void> {
    this.clearResources()
    this.device.gatt?.disconnect()
  }

  async forget(): Promise<void> {
    await this.close()
    await this.device.forget?.()
  }

  addEventListener(_type: "disconnect", listener: () => void): void {
    this.disconnectListeners.add(listener)
  }

  removeEventListener(_type: "disconnect", listener: () => void): void {
    this.disconnectListeners.delete(listener)
  }
}

export interface BluetoothAdapter extends SerialAdapter {
  getPorts(): Promise<BluetoothSerialPort[]>
  requestPort(): Promise<BluetoothSerialPort>
}

export function createBluetoothAdapter(
  bluetooth?: WebBluetooth
): BluetoothAdapter {
  const api =
    bluetooth ??
    (typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { bluetooth?: WebBluetooth }).bluetooth)

  if (api === undefined)
    throw new Error(
      "Web Bluetooth is unavailable. Use a supported browser in a secure context."
    )

  const ports = new Map<string, BluetoothSerialPort>()

  const wrap = (device: WebBluetoothDevice): BluetoothSerialPort => {
    let port = ports.get(device.id)

    if (port === undefined) {
      port = new BluetoothSerialPort(device)
      ports.set(device.id, port)
    }

    return port
  }

  return {
    async getPorts() {
      // getDevices is not implemented by every Web Bluetooth browser.
      if (api.getDevices !== undefined)
        return (await api.getDevices()).map(wrap)

      return [...ports.values()]
    },
    async requestPort() {
      return wrap(
        await api.requestDevice({
          filters: [{ services: [V5_BLUETOOTH_SERVICE] }],
        })
      )
    },
  }
}

/** V5 protocol connection with BLE discovery and PIN pairing. */
export class V5BluetoothConnection extends V5SerialConnection {
  filters = []

  constructor(
    adapter: BluetoothAdapter = createBluetoothAdapter(),
    options: VexSerialConnectionOptions = {}
  ) {
    super(adapter, options)
  }

  private bluetoothPort(): BluetoothSerialPort {
    if (!(this.port instanceof BluetoothSerialPort))
      throw new Error("Bluetooth connection is closed")

    return this.port
  }

  isPaired(): Promise<boolean> {
    return this.bluetoothPort().isPaired()
  }

  requestPairing(): Promise<void> {
    return this.bluetoothPort().requestPairing()
  }

  authenticatePairing(pin: string | Uint8Array): Promise<void> {
    return this.bluetoothPort().authenticatePairing(pin)
  }
}
