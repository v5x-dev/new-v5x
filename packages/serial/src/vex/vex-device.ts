import { unzip } from "unzipit"
import type { SerialAdapter } from "../adapters/serial-adapter"
import {
  type MatchMode,
  SerialDeviceType,
  type SlotNumber,
  type ISmartDeviceInfo,
  SmartDeviceType,
  FileVendor,
  type IProgramInfo,
  FileExitAction,
  type IFileHandle,
  FileDownloadTarget,
  USER_FLASH_USR_CODE_START,
  type IFileBasicInfo,
  type IFileWriteRequest,
  RadioChannelType,
} from "./vex"
import {
  V5SerialConnection,
  type VexSerialConnectionOptions,
} from "./vex-connection"
import { VexEventTarget } from "./vex-event"
import { VexFirmwareVersion } from "./vex-firmware-version"
import { type ProgramIniConfig } from "./vex-ini-config"
import {
  openUserProgramTerminal,
  type V5TerminalOptions,
  type V5UserProgramTerminal,
} from "./vex-terminal"
import {
  EraseFileH2DPacket,
  EraseFileReplyD2HPacket,
  ExitFileTransferH2DPacket,
  ExitFileTransferReplyD2HPacket,
  FactoryEnableH2DPacket,
  FactoryEnableReplyD2HPacket,
  FactoryStatusH2DPacket,
  FactoryStatusReplyD2HPacket,
  FileClearUpH2DPacket,
  FileClearUpReplyD2HPacket,
  FileControlH2DPacket,
  FileControlReplyD2HPacket,
  GetDirectoryEntryH2DPacket,
  GetDirectoryEntryReplyD2HPacket,
  GetDirectoryFileCountH2DPacket,
  GetDirectoryFileCountReplyD2HPacket,
  GetProgramSlotInfoH2DPacket,
  GetProgramSlotInfoReplyD2HPacket,
  ReadKeyValueH2DPacket,
  ReadKeyValueReplyD2HPacket,
  WriteKeyValueH2DPacket,
  WriteKeyValueReplyD2HPacket,
} from "./vex-packet"

export interface DownloadFileOptions {
  maxBytes?: number
  timeoutMs?: number
}

export async function downloadFileFromInternet(
  link: string,
  options: DownloadFileOptions = {}
): Promise<ArrayBuffer> {
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY
  const timeoutMs = options.timeoutMs ?? 30000
  if (
    (maxBytes !== Number.POSITIVE_INFINITY &&
      (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > 0x7fffffff
  ) {
    throw new RangeError("Invalid download limits")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(link, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`Download failed ${response.status} ${link}`)
    }

    const declaredLength = Number(response.headers.get("content-length"))
    if (Number.isSafeInteger(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`Download exceeds the ${maxBytes}-byte limit`)
    }

    if (response.body == null) {
      const body = await response.arrayBuffer()
      if (body.byteLength > maxBytes) {
        throw new Error(`Download exceeds the ${maxBytes}-byte limit`)
      }
      return body
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value === undefined) continue
        total += value.byteLength
        if (total > maxBytes) {
          throw new Error(`Download exceeds the ${maxBytes}-byte limit`)
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }

    const body = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return body.buffer
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}
export async function sleepUntilAsync(
  f: () => Promise<boolean>,
  timeout: number,
  interval = 20
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeout)
  for (;;) {
    if (await f()) return true
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    await sleep(Math.min(Math.max(0, interval), remaining))
  }
}

export async function sleepUntil(
  f: () => boolean,
  timeout: number,
  interval = 20
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeout)
  for (;;) {
    if (f()) return true
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    await sleep(Math.min(Math.max(0, interval), remaining))
  }
}

export async function sleep(ms: number): Promise<unknown> {
  return await new Promise((resolve) => setTimeout(resolve, ms))
}

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

export class V5SerialDeviceState {
  _instance: V5SerialDevice
  private refreshPauseDepth = 0

  get _isFileTransferring(): boolean {
    return this.refreshPauseDepth > 0
  }

  set _isFileTransferring(value: boolean) {
    this.refreshPauseDepth = value ? Math.max(1, this.refreshPauseDepth) : 0
  }

  get isRefreshPaused(): boolean {
    return this.refreshPauseDepth > 0
  }

  beginRefreshPause(): () => void {
    this.refreshPauseDepth++
    let released = false
    return () => {
      if (released) return
      released = true
      this.refreshPauseDepth = Math.max(0, this.refreshPauseDepth - 1)
    }
  }

  async withRefreshPaused<T>(operation: () => Promise<T> | T): Promise<T> {
    const release = this.beginRefreshPause()
    try {
      return await operation()
    } finally {
      release()
    }
  }

  brain = {
    activeProgram: 0,
    battery: {
      batteryPercent: 0,
      isCharging: false,
    },
    button: {
      isPressed: false,
      isDoublePressed: false,
    },
    cpu0Version: VexFirmwareVersion.allZero(),
    cpu1Version: VexFirmwareVersion.allZero(),
    isAvailable: false,
    settings: {
      isScreenReversed: false,
      isWhiteTheme: false,
      usingLanguage: 0,
    },
    systemVersion: VexFirmwareVersion.allZero(),
    uniqueId: 0,
  }

  controllers = [
    {
      battery: 0,
      isAvailable: false,
      isCharging: false,
    },
    {
      battery: 0,
      isAvailable: false,
    },
  ]

  devices: Array<ISmartDeviceInfo | undefined> = []
  isFieldControllerConnected = false
  matchMode: MatchMode = "disabled"
  radio = {
    channel: 0,
    isAvailable: false,
    isConnected: false,
    isVexNet: false,
    isRadioData: false,
    latency: 0,
    signalQuality: 0,
    signalStrength: 0,
  }

  constructor(instance: V5SerialDevice) {
    this._instance = instance
  }
}

export interface V5SerialDeviceOptions {
  autoRefresh?: boolean
  refreshIntervalMs?: number
  maxFileDownloadBytes?: number
}

export class V5Brain {
  private readonly state: V5SerialDeviceState

  constructor(state: V5SerialDeviceState) {
    this.state = state
  }

  get isRunningProgram(): boolean {
    return this.activeProgram !== 0
  }

  get activeProgram(): number {
    return this.state.brain.activeProgram
  }

  set activeProgram(value) {
    void (async () => {
      if (this.state.brain.activeProgram === value) return

      const conn = this.state._instance.connection
      if (conn == null) return

      const fn =
        value === 0
          ? await conn.stopProgram()
          : await conn.loadProgram(value as SlotNumber)

      if (fn != null) this.state.brain.activeProgram = value
    })()
  }

  get battery(): V5Battery {
    return new V5Battery(this.state)
  }

  get button(): V5BrainButton {
    return new V5BrainButton(this.state)
  }

  get cpu0Version(): VexFirmwareVersion {
    return this.state.brain.cpu0Version
  }

  get cpu1Version(): VexFirmwareVersion {
    return this.state.brain.cpu1Version
  }

  get isAvailable(): boolean {
    return this.state.brain.isAvailable
  }

  get settings(): V5BrainSettings {
    return new V5BrainSettings(this.state)
  }

  get systemVersion(): VexFirmwareVersion {
    return this.state.brain.systemVersion
  }

  get uniqueId(): number {
    return this.state.brain.uniqueId
  }

  async getValue(key: string): Promise<string | undefined> {
    const result = await this.state._instance.connection?.writeDataAsync(
      new ReadKeyValueH2DPacket(key)
    )
    return result instanceof ReadKeyValueReplyD2HPacket
      ? result.value
      : undefined
  }

  async setValue(key: string, value: string): Promise<boolean> {
    const result = await this.state._instance.connection?.writeDataAsync(
      new WriteKeyValueH2DPacket(key, value)
    )
    return result instanceof WriteKeyValueReplyD2HPacket
  }

  async listFiles(
    vendor = FileVendor.USER
  ): Promise<IFileHandle[] | undefined> {
    const conn = this.state._instance.connection
    if (conn == null || !conn.isConnected) return

    return this.state._instance.state.withRefreshPaused(() =>
      conn.withFileTransfer(async () => {
        const result = await conn.writeDataAsync(
          new GetDirectoryFileCountH2DPacket(vendor)
        )
        if (!(result instanceof GetDirectoryFileCountReplyD2HPacket)) return

        const files: IFileHandle[] = []
        for (let i = 0; i < result.count; i++) {
          const result2 = await conn.writeDataAsync(
            new GetDirectoryEntryH2DPacket(i)
          )
          if (!(result2 instanceof GetDirectoryEntryReplyD2HPacket)) return

          // .file is undefined if the file is not found
          // .file is a file entry but not a file handle
          if (result2.file != null) {
            files.push({
              filename: result2.file.filename,
              vendor,
              loadAddress: result2.file.loadAddress,

              size: result2.file.size,
              crc32: result2.file.crc32,

              type: result2.file.type,
              timestamp: result2.file.timestamp,
              version: result2.file.version,
            })
          }
        }

        return files
      })
    )
  }

  async listProgram(): Promise<IProgramInfo[] | undefined> {
    const conn = this.state._instance.connection
    if (conn == null || !conn.isConnected) return

    const files = await this.listFiles(FileVendor.USER)
    if (files === undefined) return

    const programList: IProgramInfo[] = []
    const iniFiles = files.filter((file) => file.filename.endsWith(".ini"))

    for (let i = 0; i < iniFiles.length; i++) {
      const ini = iniFiles[i]
      if (ini.size === 0) continue

      const programName = /(.+?)(\.[^.]*$|$)/.exec(ini.filename)?.[1] ?? ""
      const bin = files.filter(
        (e) => e != null && e.filename === programName + ".bin"
      )[0]
      if (bin == null || bin.timestamp === 0 || bin.size === 0) continue

      const n = new Date()
      n.setTime(1000 * bin.timestamp)
      const program: IProgramInfo = {
        name: programName,
        binfile: bin.filename,
        size: ini.size + bin.size,
        slot: -1,
        time: n,
        requestedSlot: -1,
      }

      const result2 = await conn?.writeDataAsync(
        new GetProgramSlotInfoH2DPacket(FileVendor.USER, program.binfile)
      )
      if (result2 instanceof GetProgramSlotInfoReplyD2HPacket) {
        program.slot = result2.slot
        program.requestedSlot = result2.requestedSlot
      }
      programList.push(program)
    }
    return programList
  }

  async readFile(
    request: IFileBasicInfo | string,
    downloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
    progressCallback?: (current: number, total: number) => void
  ): Promise<Uint8Array | undefined> {
    const conn = this.state._instance.connection
    if (conn == null || !conn.isConnected) return

    const releaseRefreshPause = this.state.beginRefreshPause()

    let handle: IFileBasicInfo

    // If request is a string, then it is a filename
    if (typeof request === "string") {
      handle = { filename: request, vendor: FileVendor.USER }
    } else {
      handle = request
    }

    try {
      return await conn.downloadFileToHost(
        handle,
        downloadTarget,
        progressCallback
      )
    } finally {
      releaseRefreshPause()
    }
  }

  async removeFile(
    request: IFileBasicInfo | string
  ): Promise<boolean | undefined> {
    const conn = this.state._instance.connection
    if (conn == null || !conn.isConnected) return
    return this.state._instance.state.withRefreshPaused(() =>
      conn.removeFile(request)
    )
  }

  async removeAllFiles(): Promise<boolean | undefined> {
    const conn = this.state._instance.connection
    if (conn == null || !conn.isConnected) return undefined
    return this.state._instance.state.withRefreshPaused(() =>
      conn.removeAllFiles()
    )
  }

  async uploadFirmware(
    publicUrl = "https://content.vexrobotics.com/vexos/public/V5/",
    usingVersion?: string,
    progressCallback?: (state: string, current: number, total: number) => void
  ): Promise<boolean | undefined> {
    const device = this.state._instance
    const conn = device.connection
    if (conn == null || !conn.isConnected) return

    const pcb = progressCallback ?? (() => {})

    let vexos: ArrayBuffer, bootBin: ArrayBuffer, assertBin: ArrayBuffer

    try {
      if (usingVersion === undefined) {
        pcb("FETCH CATALOG", 0, 1)

        const catalog = await downloadFileFromInternet(
          publicUrl + "catalog.txt",
          { maxBytes: 4 * 1024 }
        )
        const latestVersion = new TextDecoder().decode(catalog).trim()
        usingVersion = latestVersion

        if (!/^[A-Za-z0-9._-]+$/.test(usingVersion)) return false

        pcb("FETCH CATALOG", 1, 1)
      }
      if (
        usingVersion === undefined ||
        !/^[A-Za-z0-9._-]+$/.test(usingVersion)
      ) {
        return false
      }

      pcb("FETCH VEXOS", 0, 1)

      vexos = await downloadFileFromInternet(
        publicUrl + usingVersion + ".vexos",
        { maxBytes: 64 * 1024 * 1024 }
      )

      pcb("FETCH VEXOS", 1, 1)
      pcb("UNZIP VEXOS", 0, 1)

      const { entries } = await unzip(vexos)
      const bootEntry = entries[usingVersion + "/BOOT.bin"]
      const assertEntry = entries[usingVersion + "/assets.bin"]
      if (bootEntry == null || assertEntry == null) return false
      if (
        bootEntry.encrypted ||
        assertEntry.encrypted ||
        bootEntry.size > 32 * 1024 * 1024 ||
        assertEntry.size > 32 * 1024 * 1024
      ) {
        return false
      }
      bootBin = await bootEntry.arrayBuffer()
      assertBin = await assertEntry.arrayBuffer()
      if (
        bootBin.byteLength === 0 ||
        assertBin.byteLength === 0 ||
        bootBin.byteLength !== bootEntry.size ||
        assertBin.byteLength !== assertEntry.size
      ) {
        return false
      }
      if (bootBin.byteLength + assertBin.byteLength > 48 * 1024 * 1024) {
        return false
      }

      pcb("UNZIP VEXOS", 1, 1)
    } catch (e) {
      return undefined
    }

    const releaseRefreshPause = this.state.beginRefreshPause()
    try {
      pcb("FACTORY ENB BOOT", 0, 0)

      const result = await conn.writeDataAsync(new FactoryEnableH2DPacket())
      if (!(result instanceof FactoryEnableReplyD2HPacket)) return false

      const bootWriteRequest: IFileWriteRequest = {
        filename: "null.bin",
        vendor: FileVendor.USER,
        loadAddress: USER_FLASH_USR_CODE_START,
        buf: new Uint8Array(bootBin),
        downloadTarget: FileDownloadTarget.FILE_TARGET_B1,
        exttype: "bin",
        autoRun: true, // need to set EXIT_RUN
        linkedFile: undefined,
      }

      const result2 = await conn.uploadFileToDevice(
        bootWriteRequest,
        (c, t) => {
          pcb("UPLOAD BOOT", c, t)
        }
      )
      if (!result2) return false

      while (true) {
        const result3 = await conn.writeDataAsync(
          new FactoryStatusH2DPacket(),
          10000
        )
        if (result3 instanceof FactoryStatusReplyD2HPacket) {
          switch (result3.status) {
            case 2:
              pcb("ERASE BOOT", result3.percent, 100)
              break
            case 3:
              pcb("WRITE BOOT", result3.percent, 100)
              break
            case 4:
              pcb("VERIFY BOOT", result3.percent, 100)
              break
            case 8:
              pcb("FINISHING BOOT", result3.percent, 100)
              break
          }
          if (result3.status === 0 && result3.percent === 100) break
        } else {
          return false
        }
        await sleep(500)
      }

      pcb("FACTORY ENB ASSERT", 0, 0)

      const result5 = await conn.writeDataAsync(new FactoryEnableH2DPacket())
      if (!(result5 instanceof FactoryEnableReplyD2HPacket)) return false

      const assertWriteRequest: IFileWriteRequest = {
        filename: "null.bin",
        vendor: FileVendor.USER,
        loadAddress: USER_FLASH_USR_CODE_START,
        buf: new Uint8Array(assertBin),
        downloadTarget: FileDownloadTarget.FILE_TARGET_A1,
        exttype: "bin",
        autoRun: true, // need to set EXIT_RUN
        linkedFile: undefined,
      }

      const result6 = await conn.uploadFileToDevice(
        assertWriteRequest,
        (c, t) => {
          pcb("UPLOAD ASSERT", c, t)
        }
      )
      if (!result6) return false

      while (true) {
        const result7 = await conn.writeDataAsync(
          new FactoryStatusH2DPacket(),
          10000
        )
        if (result7 instanceof FactoryStatusReplyD2HPacket) {
          switch (result7.status) {
            case 2:
              pcb("ERASE ASSERT", result7.percent, 100)
              break
            case 3:
              pcb("WRITE ASSERT", result7.percent, 100)
              break
            case 4:
              pcb("VERIFY ASSERT", result7.percent, 100)
              break
            case 8:
              pcb("FINISHING ASSERT", result7.percent, 100)
              break
          }

          if (result7.status === 0 && result7.percent === 100) break
        } else {
          return false
        }
        await sleep(500)
      }
      return true
    } finally {
      releaseRefreshPause()
    }
  }

  async uploadProgram(
    iniConfig: ProgramIniConfig,
    binFileBuf: Uint8Array,
    coldFileBuf: Uint8Array | undefined,
    progressCallback: (state: string, current: number, total: number) => void
  ): Promise<boolean | undefined> {
    const device = this.state._instance
    const conn = device.connection
    if (conn == null || !conn.isConnected) return

    const releaseRefreshPause = this.state.beginRefreshPause()

    let switchedToDownload = false
    try {
      if (device.isV5Controller) {
        await sleep(250)

        // V5 Controller doesn\'t appear to be connected to a V5 Brain
        if (!(await device.refresh())) return

        const p1 = await device.radio.changeChannel(RadioChannelType.DOWNLOAD)
        if (!p1) return false
        switchedToDownload = true

        await sleep(250)
        await sleepUntilAsync(
          async () => (await conn?.getSystemStatus(150)) != null,
          10000,
          200
        )
      }

      const p2 = await conn.uploadProgramToDevice(
        iniConfig,
        binFileBuf,
        coldFileBuf,
        progressCallback
      )
      if (!(p2 ?? false)) return false

      if (device.isV5Controller) {
        // Disconnected
        if (!device.brain.isAvailable) return false

        const p3 = await device.radio.changeChannel(RadioChannelType.PIT)
        if (!p3) return false
        switchedToDownload = false

        await sleep(250)
        await sleepUntilAsync(
          async () => (await conn?.getSystemStatus(150)) != null,
          10000,
          200
        )
      }

      return true
    } finally {
      try {
        if (switchedToDownload) {
          const restored = await device.radio.changeChannel(
            RadioChannelType.PIT
          )
          if (!restored) {
            try {
              this.state._instance.emit(
                "error",
                new Error("failed to restore the controller PIT channel")
              )
            } catch {}
          }
        }
      } finally {
        releaseRefreshPause()
      }
    }
  }

  async writeFile(
    request: IFileWriteRequest,
    progressCallback?: (current: number, total: number) => void
  ): Promise<boolean | undefined> {
    const releaseRefreshPause = this.state.beginRefreshPause()
    try {
      const conn = this.state._instance.connection
      if (conn == null || !conn.isConnected) return undefined
      return await conn.uploadFileToDevice(request, progressCallback)
    } finally {
      releaseRefreshPause()
    }
  }

  /**
   *
   * @param progressCallback Informs the progress of the download.
   * @returns array of bytes where each pixel is represented by 3 consecutive bytes (rgb).
   * This array's length is 272 width * 480 height * 3 channels = 391680 bytes.
   */
  async captureScreen(
    progressCallback?: (current: number, total: number) => void
  ): Promise<Uint8Array | undefined> {
    const conn = this.state._instance.connection
    if (conn == null || !conn.isConnected) return undefined
    return this.state._instance.state.withRefreshPaused(() =>
      conn.captureScreen(progressCallback)
    )
  }
}

export class V5Battery {
  private readonly state: V5SerialDeviceState

  constructor(state: V5SerialDeviceState) {
    this.state = state
  }

  get batteryPercent(): number {
    return this.state.brain.battery.batteryPercent
  }

  get isCharging(): boolean {
    return this.state.brain.battery.isCharging
  }
}

export class V5BrainButton {
  private readonly state: V5SerialDeviceState

  constructor(state: V5SerialDeviceState) {
    this.state = state
  }

  get isPressed(): boolean {
    return this.state.brain.button.isPressed
  }

  get isDoublePressed(): boolean {
    return this.state.brain.button.isDoublePressed
  }
}

export class V5BrainSettings {
  private readonly state: V5SerialDeviceState

  constructor(state: V5SerialDeviceState) {
    this.state = state
  }

  get isScreenReversed(): boolean {
    return this.state.brain.settings.isScreenReversed
  }

  get isWhiteTheme(): boolean {
    return this.state.brain.settings.isWhiteTheme
  }

  get usingLanguage(): number {
    return this.state.brain.settings.usingLanguage
  }
}

export class V5Controller {
  private readonly state: V5SerialDeviceState
  private readonly controllerIndex: number

  constructor(state: V5SerialDeviceState, controllerIndex: number) {
    this.state = state
    this.controllerIndex = controllerIndex
  }

  get batteryPercent(): number {
    return this.state.controllers[this.controllerIndex].battery
  }

  get isMasterController(): boolean {
    return this.controllerIndex === 0
  }

  get isAvailable(): boolean {
    return this.state.controllers[this.controllerIndex].isAvailable
  }

  get isCharging(): boolean | undefined {
    return this.state.controllers[this.controllerIndex].isCharging
  }
}

export class V5SmartDevice {
  private readonly state: V5SerialDeviceState
  private readonly deviceIndex: number

  constructor(state: V5SerialDeviceState, index: number) {
    this.state = state
    this.deviceIndex = index
  }

  protected getDeviceInfo(): ISmartDeviceInfo | undefined {
    return this.state.devices[this.deviceIndex]
  }

  get isAvailable(): boolean {
    return this.getDeviceInfo() !== undefined
  }

  get port(): number {
    return this.deviceIndex
  }

  get type(): SmartDeviceType {
    return this.getDeviceInfo()?.type ?? SmartDeviceType.EMPTY
  }

  get version(): number {
    return this.getDeviceInfo()?.version ?? 0
  }
}

export class V5Radio {
  private readonly state: V5SerialDeviceState

  constructor(state: V5SerialDeviceState) {
    this.state = state
  }

  get channel(): number {
    return this.state.radio.channel
  }

  get isAvailable(): boolean {
    return this.state.radio.isAvailable
  }

  get isConnected(): boolean {
    return this.state.radio.isConnected
  }

  get isVexNet(): boolean {
    return this.state.radio.isVexNet
  }

  get isRadioData(): boolean {
    return this.state.radio.isRadioData
  }

  get latency(): number {
    return this.state.radio.latency
  }

  async changeChannel(channel: RadioChannelType): Promise<boolean> {
    const result = await this.state._instance.connection?.writeDataAsync(
      new FileControlH2DPacket(1, channel)
    )
    return result instanceof FileControlReplyD2HPacket
  }
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
    void terminal.close().then(() => this.terminals.delete(terminal))
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
