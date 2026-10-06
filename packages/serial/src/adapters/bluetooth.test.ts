import { expect, test } from "bun:test"
import {
  BluetoothSerialPort,
  createBluetoothAdapter,
  V5BluetoothConnection,
  V5_BLUETOOTH_SERVICE,
  V5_BLUETOOTH_CHARACTERISTICS,
  type WebBluetoothCharacteristic,
  type WebBluetoothDevice,
} from "./bluetooth"
import { FileDownloadTarget } from "../vex/vex"
import { PacketEncoder } from "../vex/vex-packet"

class Characteristic extends EventTarget implements WebBluetoothCharacteristic {
  value: DataView = new DataView(
    new Uint8Array([0xde, 0xad, 0xfa, 0xce]).buffer
  )

  writes: Uint8Array[] = []
  notifications = 0
  failNotifications = false
  onWrite?: (bytes: Uint8Array) => void

  async readValue() {
    return this.value
  }

  async writeValueWithoutResponse(value: BufferSource) {
    const bytes = ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
      : new Uint8Array(value).slice()

    this.writes.push(bytes)
    this.onWrite?.(bytes)
  }

  async startNotifications() {
    if (this.failNotifications) throw new Error("Subscribe failed")
    this.notifications++
    return this
  }

  notify(bytes: Uint8Array) {
    // Use a nonzero offset to catch adapters that copy the entire buffer.
    const buffer = new Uint8Array(bytes.length + 4)
    buffer.set(bytes, 2)
    this.value = new DataView(buffer.buffer, 2, bytes.length)
    this.dispatchEvent(new Event("characteristicvaluechanged"))
  }
}

function peripheral() {
  const characteristics = Object.fromEntries(
    Object.keys(V5_BLUETOOTH_CHARACTERISTICS).map((key) => [
      key,
      new Characteristic(),
    ])
  ) as Record<keyof typeof V5_BLUETOOTH_CHARACTERISTICS, Characteristic>

  const device = new EventTarget() as WebBluetoothDevice

  const gatt = {
    connected: false,
    async connect() {
      this.connected = true

      return {
        async getPrimaryService(uuid: string) {
          expect(uuid).toBe(V5_BLUETOOTH_SERVICE)

          return {
            async getCharacteristic(uuid: string) {
              const key = (
                Object.keys(
                  V5_BLUETOOTH_CHARACTERISTICS
                ) as (keyof typeof V5_BLUETOOTH_CHARACTERISTICS)[]
              ).find((key) => V5_BLUETOOTH_CHARACTERISTICS[key] === uuid)!

              return characteristics[key]
            },
          }
        },
      }
    },
    disconnect() {
      this.connected = false
      device.dispatchEvent(new Event("gattserverdisconnected"))
    },
  }

  Object.assign(device, { id: "v5-brain", gatt })

  const adapter = createBluetoothAdapter({
    getDevices: async () => [device],
    requestDevice: async (options) => {
      expect(options.filters).toEqual([{ services: [V5_BLUETOOTH_SERVICE] }])
      return device
    },
  })

  characteristics.pairing.onWrite = (bytes) => {
    if (bytes.every((byte) => byte <= 9))
      characteristics.pairing.value = new DataView(bytes.buffer)
  }

  return { characteristics, device, gatt, adapter }
}

function reply(extendedCommand: number, body = new Uint8Array()): Uint8Array {
  const packet = new Uint8Array(8 + body.length)
  packet.set([0xaa, 0x55, 86, body.length + 4, extendedCommand, 0x76])
  packet.set(body, 6)

  const crc = PacketEncoder.getInstance().crcgen.crc16(
    packet.subarray(0, -2),
    0
  )

  packet[packet.length - 2] = crc >>> 8
  packet[packet.length - 1] = crc & 255
  return packet
}

test("BLE discovery reuses granted ports and supports browsers without getDevices", async () => {
  const { adapter, device } = peripheral()
  const port = await adapter.requestPort()
  expect((await adapter.getPorts())[0]).toBe(port)
  const fallback = createBluetoothAdapter({ requestDevice: async () => device })
  expect(await fallback.getPorts()).toEqual([])
  const selected = await fallback.requestPort()
  expect(await fallback.getPorts()).toEqual([selected])
})

test("BLE pairing sends numeric PIN digits and checks the returned PIN", async () => {
  const { adapter, characteristics } = peripheral()
  const connection = new V5BluetoothConnection(adapter)
  expect(await connection.open(0, false)).toBe(true)
  expect(await connection.isPaired()).toBe(false)
  await connection.requestPairing()

  expect(characteristics.pairing.writes[0]).toEqual(
    new Uint8Array([255, 255, 255, 255])
  )

  await expect(connection.authenticatePairing("123")).rejects.toThrow(
    "four digits"
  )

  await connection.authenticatePairing("0123")

  expect(characteristics.pairing.writes[1]).toEqual(
    new Uint8Array([0, 1, 2, 3])
  )

  expect(await connection.isPaired()).toBe(true)
  characteristics.pairing.onWrite = () => {}

  await expect(connection.authenticatePairing("4567")).rejects.toThrow(
    "Incorrect"
  )

  characteristics.pairing.value = new DataView(new ArrayBuffer(2))
  await expect(connection.isPaired()).rejects.toThrow("Invalid")
  await connection.close()
})

test("BLE keeps protocol notifications separate from terminal data and chunks stdin", async () => {
  const { adapter, characteristics } = peripheral()
  const port = await adapter.requestPort()
  await port.open({ baudRate: 115200 })
  const reader = port.readable!.getReader()
  characteristics.systemTx.notify(new Uint8Array([0xaa, 0x55]))
  characteristics.userTx.notify(new Uint8Array([65, 0, 66]))
  expect((await reader.read()).value).toEqual(new Uint8Array([0xaa, 0x55]))
  expect(await port.readUser()).toEqual(new Uint8Array([65, 0, 66]))
  expect(await port.readUser()).toEqual(new Uint8Array())
  await port.authenticatePairing("1234")
  expect(await port.writeUser(new Uint8Array(500))).toBe(500)

  expect(characteristics.userRx.writes.map((data) => data.length)).toEqual([
    244, 244, 12,
  ])

  expect(characteristics.systemRx.writes).toEqual([])
  await reader.cancel()
  reader.releaseLock()
  await port.close()
})

test("BLE rejects unpaired and oversized protocol writes", async () => {
  const { device } = peripheral()
  const port = new BluetoothSerialPort(device)
  await port.open({ baudRate: 115200 })
  const writer = port.writable!.getWriter()

  await expect(writer.write(new Uint8Array([1]))).rejects.toThrow(
    "pairing is required"
  )

  writer.releaseLock()
  await port.close()
  await port.open({ baudRate: 115200 })
  const secondWriter = port.writable!.getWriter()

  await expect(secondWriter.write(new Uint8Array(245))).rejects.toThrow(
    "at most 244"
  )

  secondWriter.releaseLock()
  await port.close()
})

test("BLE disconnect closes pending reads and permits reconnect without stale listeners", async () => {
  const { adapter, characteristics, gatt } = peripheral()
  const connection = new V5BluetoothConnection(adapter)
  let disconnected = 0
  connection.on("disconnected", () => disconnected++)
  expect(await connection.open(0, false)).toBe(true)
  gatt.disconnect()
  for (let i = 0; i < 100 && disconnected === 0; i++) await Bun.sleep(0)
  expect(connection.isConnected).toBe(false)
  expect(disconnected).toBe(1)
  expect(await connection.open(0, false)).toBe(true)
  characteristics.userTx.notify(new Uint8Array([42]))
  expect(await connection.readUserFifo()).toEqual(new Uint8Array([42]))
  await connection.close()
  expect(disconnected).toBe(2)
})

test("BLE cleans up when notification setup fails", async () => {
  const { device, characteristics, gatt } = peripheral()
  const port = new BluetoothSerialPort(device)
  characteristics.userTx.failNotifications = true

  await expect(port.open({ baudRate: 115200 })).rejects.toThrow(
    "Subscribe failed"
  )

  expect(gatt.connected).toBe(false)
  expect(port.readable).toBeNull()
  characteristics.systemTx.notify(new Uint8Array([1]))
  characteristics.userTx.failNotifications = false
  await port.open({ baudRate: 115200 })
  await port.close()
})

test("BLE file uploads honor the negotiated window and need no write replies", async () => {
  const { adapter, characteristics } = peripheral()
  const connection = new V5BluetoothConnection(adapter)
  await connection.open(0, false)
  await connection.authenticatePairing("1234")

  characteristics.systemRx.onWrite = (bytes) => {
    if (bytes[5] === 17) {
      const body = new Uint8Array(10)
      new DataView(body.buffer).setUint16(0, 512, true)
      const packet = reply(17, body)
      characteristics.systemTx.notify(packet.slice(0, 3))
      characteristics.systemTx.notify(packet.slice(3))
    } else if (bytes[5] === 18) {
      characteristics.systemTx.notify(reply(18))
    } else {
      expect(bytes[5]).toBe(19)
      // Deliberately do not send a file-write reply.
    }
  }

  const progress: number[] = []

  expect(
    await connection.uploadFileToDevice(
      {
        filename: "test.bin",
        buf: new Uint8Array(501),
        downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
        autoRun: false,
      },
      (current) => progress.push(current)
    )
  ).toBe(true)

  const writes = characteristics.systemRx.writes.filter(
    (data) => data[5] === 19
  )

  expect(writes).toHaveLength(3)
  expect(writes.every((data) => data.length <= 244)).toBe(true)
  expect(progress).toEqual([0, 228, 456, 501])
  expect(connection.callbacksQueue).toHaveLength(0)
  await connection.close()
})

test("BLE serializes GATT operations across pairing, protocol, and user writes", async () => {
  const { adapter, characteristics } = peripheral()
  const port = await adapter.requestPort()
  await port.open({ baudRate: 115200 })
  await port.authenticatePairing("1234")
  let active = false
  let overlap = false

  for (const characteristic of Object.values(characteristics)) {
    const read = characteristic.readValue.bind(characteristic)
    const write = characteristic.writeValueWithoutResponse.bind(characteristic)

    const run = async <T>(operation: () => Promise<T>): Promise<T> => {
      if (active) overlap = true
      active = true
      await Bun.sleep(1)

      try {
        return await operation()
      } finally {
        active = false
      }
    }

    characteristic.readValue = () => run(read)

    characteristic.writeValueWithoutResponse = (bytes) =>
      run(() => write(bytes))
  }

  const writer = port.writable!.getWriter()

  await Promise.all([
    port.isPaired(),
    writer.write(new Uint8Array([1])),
    port.writeUser(new Uint8Array([2])),
  ])

  expect(overlap).toBe(false)
  expect(characteristics.systemRx.writes).toEqual([new Uint8Array([1])])
  expect(characteristics.userRx.writes).toEqual([new Uint8Array([2])])
  await writer.close()
  writer.releaseLock()
  await port.close()
})
