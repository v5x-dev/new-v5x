import { unzip } from "unzipit"
import {
  type SlotNumber,
  FileVendor,
  type IProgramInfo,
  type IFileHandle,
  FileDownloadTarget,
  USER_FLASH_USR_CODE_START,
  type IFileBasicInfo,
  type IFileWriteRequest,
  RadioChannelType,
} from "../vex"
import { VexFirmwareVersion } from "../vex-firmware-version"
import { type ProgramIniConfig } from "../vex-ini-config"
import {
  FactoryEnableH2DPacket,
  FactoryEnableReplyD2HPacket,
  FactoryStatusH2DPacket,
  FactoryStatusReplyD2HPacket,
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
} from "../vex-packet"
import { V5Battery, V5BrainButton, V5BrainSettings } from "./components"
import { downloadFileFromInternet } from "./download"
import { sleep, sleepUntilAsync } from "./sleep"
import { V5SerialDeviceState } from "./state"

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
    } catch {
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
