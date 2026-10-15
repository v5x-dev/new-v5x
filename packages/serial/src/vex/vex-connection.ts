import {
  AckType,
  FileDownloadTarget,
  FileExitAction,
  FileLoadAction,
  FileVendor,
  type IFileBasicInfo,
  type IFileWriteRequest,
  type MatchMode,
  SerialDeviceType,
  type SlotNumber,
  USER_FIFO_MAX_WRITE_SIZE,
  UserFifoChannel,
  type SelectDashScreen,
} from "./vex"
import { type ProgramIniConfig } from "./vex-ini-config"
import {
  downloadFile,
  uploadFile,
  uploadProgram,
} from "./connection/file-transfer"
import { transferChunkSize, trimTrailingNuls } from "./connection/payload"
import {
  EraseFileH2DPacket,
  EraseFileReplyD2HPacket,
  ExitFileTransferH2DPacket,
  ExitFileTransferReplyD2HPacket,
  FileClearUpH2DPacket,
  FileClearUpReplyD2HPacket,
  GetDeviceStatusH2DPacket,
  GetDeviceStatusReplyD2HPacket,
  GetMatchStatusH2DPacket,
  GetRadioStatusH2DPacket,
  GetRadioStatusReplyD2HPacket,
  GetSystemFlagsH2DPacket,
  GetSystemFlagsReplyD2HPacket,
  GetSystemStatusH2DPacket,
  GetSystemStatusReplyD2HPacket,
  type HostBoundPacket,
  LoadFileActionH2DPacket,
  LoadFileActionReplyD2HPacket,
  MatchModeReplyD2HPacket,
  MatchStatusReplyD2HPacket,
  ScreenCaptureH2DPacket,
  ScreenCaptureReplyD2HPacket,
  SelectDashH2DPacket,
  SelectDashReplyD2HPacket,
  SendDashTouchH2DPacket,
  SendDashTouchReplyD2HPacket,
  UpdateMatchModeH2DPacket,
  UserFifoH2DPacket,
  UserFifoReplyD2HPacket,
} from "./vex-packet"
import type {
  SerialAdapter,
  SerialPortFilter,
} from "../adapters/serial-adapter"
import { convertScreenCapture } from "../screen-capture"
import {
  DEFAULT_MAX_FILE_DOWNLOAD_BYTES,
  DEFAULT_TRANSFER_WINDOW_SIZE,
  DEFAULT_USER_FIFO_TIMEOUT,
  VexSerialConnection,
} from "./connection/session"
import type {
  VexSerialConnectionEvents,
  VexSerialConnectionOptions,
} from "./connection/session"

export {
  DEFAULT_MAX_FILE_DOWNLOAD_BYTES,
  DEFAULT_TRANSFER_WINDOW_SIZE,
  DEFAULT_USER_FIFO_TIMEOUT,
  VexSerialConnection,
}
export type { VexSerialConnectionEvents, VexSerialConnectionOptions }

export class V5SerialConnection extends VexSerialConnection {
  filters: SerialPortFilter[] = [
    { usbVendorId: 10376, usbProductId: SerialDeviceType.V5_BRAIN },
    { usbVendorId: 10376, usbProductId: SerialDeviceType.V5_BRAIN_DFU },
    { usbVendorId: 10376, usbProductId: SerialDeviceType.V5_CONTROLLER },
  ]

  constructor(serial: SerialAdapter, options: VexSerialConnectionOptions = {}) {
    super(serial, options)
  }

  async getDeviceStatus(): Promise<GetDeviceStatusReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new GetDeviceStatusH2DPacket())
    return result instanceof GetDeviceStatusReplyD2HPacket ? result : null
  }

  async getRadioStatus(): Promise<GetRadioStatusReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new GetRadioStatusH2DPacket())
    return result instanceof GetRadioStatusReplyD2HPacket ? result : null
  }

  async getSystemFlags(): Promise<GetSystemFlagsReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new GetSystemFlagsH2DPacket())
    return result instanceof GetSystemFlagsReplyD2HPacket ? result : null
  }

  async getSystemStatus(
    timeout = 1000
  ): Promise<GetSystemStatusReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new GetSystemStatusH2DPacket(),
      timeout
    )

    return result instanceof GetSystemStatusReplyD2HPacket ? result : null
  }

  async getMatchStatus(): Promise<MatchStatusReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new GetMatchStatusH2DPacket())
    return result instanceof MatchStatusReplyD2HPacket ? result : null
  }

  async uploadProgramToDevice(
    iniConfig: ProgramIniConfig,
    binFileBuf: Uint8Array,
    coldFileBuf: Uint8Array | undefined,
    progressCallback: (state: string, current: number, total: number) => void
  ): Promise<boolean | undefined> {
    return this.fileTransfers.run(() =>
      uploadProgram(this, iniConfig, binFileBuf, coldFileBuf, progressCallback)
    )
  }

  async downloadFileToHost(
    request: IFileBasicInfo,
    downloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
    progressCallback?: (current: number, total: number) => void
  ): Promise<Uint8Array> {
    return this.fileTransfers.run(() =>
      this.downloadFileToHostUnlocked(request, downloadTarget, progressCallback)
    )
  }

  /** Download without taking the file-transfer lock. */
  async downloadFileToHostUnlocked(
    request: IFileBasicInfo,
    downloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
    progressCallback?: (current: number, total: number) => void
  ): Promise<Uint8Array> {
    return downloadFile(
      this.transferIo(),
      request,
      downloadTarget,
      progressCallback
    )
  }

  async uploadFileToDevice(
    request: IFileWriteRequest,
    progressCallback?: (current: number, total: number) => void
  ): Promise<boolean> {
    return this.fileTransfers.run(() =>
      this.uploadFileToDeviceUnlocked(request, progressCallback)
    )
  }

  /** Upload without taking the file-transfer lock. */
  async uploadFileToDeviceUnlocked(
    request: IFileWriteRequest,
    progressCallback?: (current: number, total: number) => void
  ): Promise<boolean> {
    return uploadFile(this.transferIo(), request, progressCallback)
  }

  async withFileTransfer<T>(operation: () => Promise<T> | T): Promise<T> {
    return this.fileTransfers.run(operation)
  }

  async removeFile(request: IFileBasicInfo | string): Promise<boolean> {
    const vendor =
      typeof request === "string" ? FileVendor.USER : request.vendor

    const filename = typeof request === "string" ? request : request.filename

    return this.fileTransfers.run(async () => {
      const result = await this.writeDataAsync(
        new EraseFileH2DPacket(vendor, filename)
      )

      const exit = await this.writeDataAsync(
        new ExitFileTransferH2DPacket(FileExitAction.EXIT_HALT),
        30000
      )

      return (
        result instanceof EraseFileReplyD2HPacket &&
        exit instanceof ExitFileTransferReplyD2HPacket
      )
    })
  }

  async removeAllFiles(): Promise<boolean> {
    return this.fileTransfers.run(async () => {
      let result: HostBoundPacket | ArrayBuffer | Uint8Array | AckType

      try {
        result = await this.writeDataAsync(
          new FileClearUpH2DPacket(FileVendor.USER),
          30000
        )
      } finally {
        await this.writeDataAsync(
          new ExitFileTransferH2DPacket(FileExitAction.EXIT_HALT),
          30000
        )
      }

      return result instanceof FileClearUpReplyD2HPacket
    })
  }

  async captureScreenSetup(): Promise<ScreenCaptureReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new ScreenCaptureH2DPacket(0))
    return result instanceof ScreenCaptureReplyD2HPacket ? result : null
  }

  async captureScreen(
    progressCallback?: (current: number, total: number) => void
  ): Promise<Uint8Array | undefined> {
    return this.fileTransfers.run(async () => {
      const response = await this.captureScreenSetup()
      if (response === null) return undefined

      const framebuffer = await this.downloadFileToHostUnlocked(
        {
          filename: "screen",
          vendor: FileVendor.SYS,
          loadAddress: 0,
          size: 512 * 272 * 4,
        },
        FileDownloadTarget.FILE_TARGET_CBUF,
        progressCallback
      )

      return convertScreenCapture(framebuffer)
    })
  }

  private transferIo() {
    const isConnected = () => this.isConnected
    const isClosing = () => this.isClosing
    const writer = () => this.writer
    const port = () => this.port
    const maxFileDownloadBytes = () => this.maxFileDownloadBytes
    return {
      get isConnected() {
        return isConnected()
      },
      get isClosing() {
        return isClosing()
      },
      get writer() {
        return writer()
      },
      get port() {
        return port()
      },
      get maxFileDownloadBytes() {
        return maxFileDownloadBytes()
      },
      writeDataAsync: (
        rawData: Parameters<V5SerialConnection["writeDataAsync"]>[0],
        timeout?: number
      ) => this.writeDataAsync(rawData, timeout),
      emitWarning: (message: string, details?: unknown) =>
        this.emitWarning(message, details),
      chunkSize: (windowSize: number) =>
        this.getFileTransferChunkSize(windowSize),
    }
  }

  private getFileTransferChunkSize(windowSize: number): number {
    const maxPacketSize = this.port?.maxPacketSize

    if (maxPacketSize === undefined)
      return Math.max(4, transferChunkSize(windowSize))

    // BLE uses half the advertised window and reserves 14 bytes for framing.
    const size =
      Math.floor((Math.min(maxPacketSize, windowSize / 2) - 14) / 4) * 4

    if (size < 4) throw new Error("Bluetooth file transfer window is too small")
    return size
  }

  async readUserFifo(
    channel: UserFifoChannel = UserFifoChannel.STDOUT,
    timeout = DEFAULT_USER_FIFO_TIMEOUT
  ): Promise<Uint8Array | undefined> {
    if (this.port?.readUser !== undefined) {
      if (channel !== UserFifoChannel.STDOUT) return undefined

      try {
        return await this.port.readUser()
      } catch {
        return undefined
      }
    }

    const result = await this.writeDataAsync(
      new UserFifoH2DPacket(channel),
      timeout
    )

    return result instanceof UserFifoReplyD2HPacket
      ? trimTrailingNuls(result.buf)
      : undefined
  }

  async writeUserFifo(
    data: Uint8Array | string,
    channel: UserFifoChannel = UserFifoChannel.STDIN,
    timeout = DEFAULT_USER_FIFO_TIMEOUT
  ): Promise<number | undefined> {
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data

    if (this.port?.writeUser !== undefined) {
      if (channel !== UserFifoChannel.STDIN) return undefined

      try {
        return await this.port.writeUser(bytes)
      } catch {
        return undefined
      }
    }

    for (let offset = 0; offset < bytes.byteLength;) {
      const chunk = bytes.subarray(offset, offset + USER_FIFO_MAX_WRITE_SIZE)

      const result = await this.writeDataAsync(
        new UserFifoH2DPacket(channel, chunk),
        timeout
      )

      if (!(result instanceof UserFifoReplyD2HPacket)) return undefined
      offset += chunk.byteLength
    }

    return bytes.byteLength
  }

  async setMatchMode(mode: MatchMode): Promise<MatchModeReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new UpdateMatchModeH2DPacket(mode, 0)
    )

    return result instanceof MatchModeReplyD2HPacket ? result : null
  }

  async loadProgram(
    value: SlotNumber | string
  ): Promise<LoadFileActionReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new LoadFileActionH2DPacket(FileVendor.USER, FileLoadAction.RUN, value)
    )

    return result instanceof LoadFileActionReplyD2HPacket ? result : null
  }

  async stopProgram(): Promise<LoadFileActionReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new LoadFileActionH2DPacket(FileVendor.USER, FileLoadAction.STOP, "")
    )

    return result instanceof LoadFileActionReplyD2HPacket ? result : null
  }

  async runProgram(
    value: SlotNumber | string
  ): Promise<LoadFileActionReplyD2HPacket | null> {
    return this.loadProgram(value)
  }

  async mockTouch(
    x: number,
    y: number,
    press: boolean
  ): Promise<SendDashTouchReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new SendDashTouchH2DPacket(x, y, press)
    )

    return result instanceof SendDashTouchReplyD2HPacket ? result : null
  }

  /** @param port untested */
  async openScreen(
    screen: number | SelectDashScreen,
    port: number
  ): Promise<SelectDashReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new SelectDashH2DPacket(screen, port)
    )

    return result instanceof SelectDashReplyD2HPacket ? result : null
  }
}
