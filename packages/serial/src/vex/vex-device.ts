import type { SerialAdapter } from "../adapters/serial-adapter"
import { type MatchMode, SerialDeviceType } from "./vex"
import {
  V5SerialConnection,
  type VexSerialConnectionOptions,
} from "./vex-connection"
import { VexEventTarget } from "./vex-event"
import {
  openUserProgramTerminal,
  type V5TerminalOptions,
  type V5UserProgramTerminal,
} from "./vex-terminal"
import { V5Brain } from "./device/brain"
import { V5Controller, V5Radio, V5SmartDevice } from "./device/components"
import { sleepUntil, sleepUntilAsync } from "./device/sleep"
import { V5SerialDeviceState, type V5SerialDeviceOptions } from "./device/state"

export * from "./device/brain"
export * from "./device/components"
export * from "./device/download"
export * from "./device/sleep"
export * from "./device/state"

export interface VexSerialDeviceEvents {
  disconnected: undefined
  error: unknown
}

export abstract class VexSerialDevice extends VexEventTarget<VexSerialDeviceEvents> {
  connection: V5SerialConnection | undefined
  defaultSerial: SerialAdapter

  get isConnected(): boolean {
    return this.connection != null ? this.connection.isConnected : false
  }

  get deviceType(): SerialDeviceType | undefined {
    return this.isConnected
      ? this.connection?.port?.getInfo().usbProductId
      : undefined
  }

  constructor(defaultSerial: SerialAdapter) {
    super()
    this.defaultSerial = defaultSerial
  }

  abstract connect(conn?: V5SerialConnection): Promise<boolean>

  abstract disconnect(): void
}

export class V5SerialDevice extends VexSerialDevice {
  autoReconnect = true
  autoRefresh = true
  pauseRefreshOnFileTransfer = true

  protected _isReconnecting = false
  state: V5SerialDeviceState = new V5SerialDeviceState(this)
  private refreshTimer: ReturnType<typeof setInterval>
  private readonly refreshIntervalMs: number
  private readonly connectionOptions: VexSerialConnectionOptions
  private disconnectListener: ((data: undefined) => void) | undefined
  private readonly terminals = new Set<V5UserProgramTerminal>()
  private disposed = false

  constructor(
    defaultSerial: SerialAdapter,
    options: V5SerialDeviceOptions | boolean = {}
  ) {
    super(defaultSerial)

    const deviceOptions =
      typeof options === "boolean" ? { autoRefresh: options } : options

    const refreshIntervalMs = deviceOptions.refreshIntervalMs ?? 200

    if (
      !Number.isFinite(refreshIntervalMs) ||
      refreshIntervalMs <= 0 ||
      refreshIntervalMs > 0x7fffffff
    ) {
      throw new RangeError("refreshIntervalMs must be a positive finite number")
    }

    const maxFileDownloadBytes = deviceOptions.maxFileDownloadBytes

    if (
      maxFileDownloadBytes !== undefined &&
      (!Number.isSafeInteger(maxFileDownloadBytes) || maxFileDownloadBytes <= 0)
    ) {
      throw new RangeError(
        "maxFileDownloadBytes must be a positive safe integer"
      )
    }

    this.refreshIntervalMs = refreshIntervalMs
    this.connectionOptions = { maxFileDownloadBytes }

    if (deviceOptions.autoRefresh !== undefined) {
      this.autoRefresh = deviceOptions.autoRefresh
    }

    let isLastRefreshComplete: boolean = true

    this.refreshTimer = setInterval(() => {
      if (this.disposed) return

      if (this.autoRefresh && isLastRefreshComplete) {
        if (!this.isConnected) {
          this.state.brain.isAvailable = false
          return
        }

        if (
          !this.pauseRefreshOnFileTransfer ||
          !this.state._isFileTransferring
        ) {
          isLastRefreshComplete = false
          void this.refresh().finally(() => (isLastRefreshComplete = true))
        }
      }
    }, this.refreshIntervalMs)

    const timer = this.refreshTimer as unknown as { unref?: () => void }
    timer.unref?.()
  }

  get isV5Controller(): boolean {
    return this.deviceType === SerialDeviceType.V5_CONTROLLER
  }

  get brain(): V5Brain {
    return new V5Brain(this.state)
  }

  get controllers(): [V5Controller, V5Controller] {
    return [new V5Controller(this.state, 0), new V5Controller(this.state, 1)]
  }

  get devices(): V5SmartDevice[] {
    const rtn = []

    for (let i = 1; i < this.state.devices.length; i++) {
      if (this.state.devices[i] != null)
        rtn.push(new V5SmartDevice(this.state, i))
    }

    return rtn
  }

  get isFieldControllerConnected(): boolean {
    return this.state.isFieldControllerConnected
  }

  get matchMode(): MatchMode {
    return this.state.matchMode
  }

  set matchMode(value) {
    void (async () => {
      if ((await this.connection?.setMatchMode(value)) != null)
        this.state.matchMode = value
    })()
  }

  get radio(): V5Radio {
    return new V5Radio(this.state)
  }

  async mockTouch(x: number, y: number, press: boolean): Promise<boolean> {
    return !((await this.connection?.mockTouch(x, y, press)) == null)
  }

  async connect(conn?: V5SerialConnection): Promise<boolean> {
    if (this.disposed) return false
    if (this.isConnected) return true

    if (conn != null) {
      if (!conn.isConnected || (await conn.query1()) === null) return false
      this.clearDisconnectListener(this.connection)
      this.connection = conn
    } else {
      let tryIdx = 0

      while (true) {
        const c = new V5SerialConnection(
          this.defaultSerial,
          this.connectionOptions
        )

        // Try each previously granted port before showing the browser chooser.
        // A chooser selection is not part of that indexed list.
        const result = await c.open(tryIdx, false)
        if (result === undefined) break // no granted port left
        tryIdx++

        if (!result) {
          // has been opened
          await c.close()
          continue
        }

        if ((await c.query1()) === null) {
          // no response
          await c.close()
          continue
        }

        this.clearDisconnectListener(this.connection)
        this.connection = c
        break
      }

      if (!this.isConnected) {
        const c = new V5SerialConnection(
          this.defaultSerial,
          this.connectionOptions
        )

        if (!(await c.open(undefined, true))) return false

        if ((await c.query1()) === null) {
          await c.close()
          return false
        }

        this.clearDisconnectListener(this.connection)
        this.connection = c
      }
    }

    if (!this.isConnected) return false

    await this.doAfterConnect()

    return true
  }

  async disconnect(): Promise<void> {
    const connection = this.connection
    this.clearDisconnectListener(connection)
    this.connection = undefined
    await connection?.close()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    clearInterval(this.refreshTimer)
    for (const terminal of this.terminals) await terminal.close()
    this.terminals.clear()
    await this.disconnect()
    this.clearListeners()
  }

  /**
   * @param timeout defaults to 0. If timeout is 0, then it will attempt to reconnect forever
   * @returns
   */
  async reconnect(timeout: number = 0): Promise<boolean> {
    if (this.disposed) return false
    if (this.isConnected) return true
    if (timeout < 0) return false

    const endTime = new Date().getTime() + timeout

    if (this._isReconnecting) {
      let successBeforeTimeout

      do {
        successBeforeTimeout = await sleepUntil(
          () => !this._isReconnecting,
          timeout === 0 ? 1000 : timeout
        )
        // eslint-disable-next-line no-unmodified-loop-condition
      } while (timeout === 0 && !successBeforeTimeout)

      if (this.isConnected) return true
      if (!successBeforeTimeout) return false
    }

    this._isReconnecting = true

    try {
      // eslint-disable-next-line no-unmodified-loop-condition
      while (timeout === 0 || new Date().getTime() < endTime) {
        let tryIdx = 0

        while (true) {
          const c = new V5SerialConnection(
            this.defaultSerial,
            this.connectionOptions
          )

          const result = await c.open(tryIdx++, false)

          if (result === undefined) break // no port left

          if (!result) {
            // has been opened
            await c.close()
            continue
          }

          const result2 = await c.getSystemStatus(200)

          if (result2 === null) {
            // no response
            await c.close()
            continue
          }

          if (
            this.brain.uniqueId !== 0 &&
            result2.uniqueId !== this.brain.uniqueId
          ) {
            // uuid not match
            await c.close()
            continue
          }

          this.clearDisconnectListener(this.connection)
          this.connection = c
          break
        }

        if (this.isConnected) break

        // try again every second or when the number of ports is different
        const getPortCount = async (): Promise<number> =>
          (await this.defaultSerial.getPorts()).length

        const portsCount = await getPortCount()

        await sleepUntilAsync(
          async () => (await getPortCount()) !== portsCount,
          1000
        )
      }
    } finally {
      this._isReconnecting = false
    }

    if (!this.isConnected) return false

    void this.doAfterConnect()

    return true
  }

  private async doAfterConnect(): Promise<void> {
    if (this.connection == null) return

    if (this.disconnectListener !== undefined) {
      this.clearDisconnectListener(this.connection)
    }

    this.disconnectListener = (_data) => {
      if (this.autoReconnect) void this.reconnect()
    }

    this.connection.on("disconnected", this.disconnectListener)

    await this.refresh()
  }

  private clearDisconnectListener(
    connection: V5SerialConnection | undefined
  ): void {
    if (connection === undefined || this.disconnectListener === undefined)
      return

    connection.remove("disconnected", this.disconnectListener)
    this.disconnectListener = undefined
  }

  openTerminal(
    options: V5TerminalOptions = {}
  ): V5UserProgramTerminal | undefined {
    const terminal = openUserProgramTerminal(this.connection, options)
    if (terminal === undefined) return undefined
    this.terminals.add(terminal)
    terminal.on("closed", () => this.terminals.delete(terminal))
    return terminal
  }

  async refresh(): Promise<boolean> {
    const conn = this.connection

    if (conn == null || !conn.isConnected) {
      this.state.brain.isAvailable = false
      return false
    }

    try {
      const ssPacket = await conn.getSystemStatus()
      const sfPacket = await conn.getSystemFlags()
      const rdPacket = await conn.getRadioStatus()
      const dsPacket = await conn.getDeviceStatus()

      if (
        ssPacket == null ||
        sfPacket == null ||
        rdPacket == null ||
        dsPacket == null
      ) {
        this.state.brain.isAvailable = false
        return false
      }

      const flags2 = ssPacket.sysflags[2]
      const flags4 = ssPacket.sysflags[4]
      const flags5 = sfPacket.flags

      const isController =
        conn.port?.getInfo().usbProductId === SerialDeviceType.V5_CONTROLLER

      const radioConnected = (flags5 & Math.pow(2, 32 - 22)) !== 0
      const controllerCharging = (flags2 & 0b10000000) !== 0

      this.state.brain.cpu0Version = ssPacket.cpu0Version
      this.state.brain.cpu1Version = ssPacket.cpu1Version
      this.state.brain.systemVersion = ssPacket.systemVersion
      this.state.controllers[0].isCharging = controllerCharging

      this.state.matchMode =
        (flags2 & 0b00100000) !== 0
          ? "disabled"
          : (flags2 & 0b01000000) !== 0
            ? "autonomous"
            : "driver"

      this.state.isFieldControllerConnected = (flags2 & 0b00010000) !== 0
      this.state.brain.settings.usingLanguage = (flags4 & 0b11110000) >> 4
      this.state.brain.settings.isWhiteTheme = (flags4 & 0b00000100) !== 0
      this.state.brain.settings.isScreenReversed = (flags4 & 0b00000001) === 0
      this.state.brain.uniqueId = ssPacket.uniqueId

      this.state.radio.isRadioData = (flags5 & Math.pow(2, 32 - 12)) !== 0

      this.state.brain.button.isDoublePressed =
        (flags5 & Math.pow(2, 32 - 14)) !== 0

      this.state.brain.battery.isCharging =
        (flags5 & Math.pow(2, 32 - 15)) !== 0

      this.state.brain.button.isPressed = (flags5 & Math.pow(2, 32 - 17)) !== 0
      this.state.radio.isVexNet = (flags5 & Math.pow(2, 32 - 18)) !== 0

      this.state.controllers[1].isAvailable =
        (flags5 & Math.pow(2, 32 - 19)) !== 0

      this.state.radio.isConnected = radioConnected
      this.state.radio.isAvailable = (flags5 & Math.pow(2, 32 - 23)) !== 0
      this.state.brain.battery.batteryPercent = sfPacket.battery ?? 0

      this.state.controllers[0].isAvailable =
        radioConnected || controllerCharging

      this.state.controllers[0].battery = sfPacket.controllerBatteryPercent ?? 0

      this.state.controllers[1].battery =
        sfPacket.partnerControllerBatteryPercent ?? 0

      this.state.brain.activeProgram = sfPacket.currentProgram
      this.state.brain.isAvailable = !isController || radioConnected
      this.state.radio.channel = rdPacket.channel
      this.state.radio.latency = rdPacket.timeslot
      this.state.radio.signalQuality = rdPacket.quality
      this.state.radio.signalStrength = rdPacket.strength

      const devices = [...this.state.devices]
      const presentPorts = new Set<number>()

      for (const device of dsPacket.devices) {
        devices[device.port] = device
        presentPorts.add(device.port)
      }

      for (let port = 0; port < devices.length; port++) {
        if (devices[port] !== undefined && !presentPorts.has(port)) {
          devices[port] = undefined
        }
      }

      this.state.devices = devices
      return true
    } catch {
      this.state.brain.isAvailable = false
      return false
    }
  }
}
