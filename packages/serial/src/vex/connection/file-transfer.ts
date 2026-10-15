import { generateProsColdLibraryName } from "../pros-cold-hash"
import type { AdapterSerialPort } from "../../adapters/serial-adapter"
import {
  AckType,
  FileDownloadTarget,
  FileExitAction,
  FileInitAction,
  FileInitOption,
  FileVendor,
  type IFileBasicInfo,
  type IFileWriteRequest,
  USER_FLASH_USR_CODE_START,
} from "../vex"
import { gzipBytes } from "./payload"
import { type ProgramIniConfig } from "../vex-ini-config"
import { VexFirmwareVersion } from "../vex-firmware-version"
import {
  DeviceBoundPacket,
  ExitFileTransferH2DPacket,
  ExitFileTransferReplyD2HPacket,
  GetFileMetadataH2DPacket,
  GetFileMetadataReplyD2HPacket,
  GetSystemStatusReplyD2HPacket,
  InitFileTransferH2DPacket,
  InitFileTransferReplyD2HPacket,
  LinkFileH2DPacket,
  LinkFileReplyD2HPacket,
  LoadFileActionReplyD2HPacket,
  PacketEncoder,
  ReadFileH2DPacket,
  ReadFileReplyD2HPacket,
  type HostBoundPacket,
  WriteFileH2DPacket,
  WriteFileReplyD2HPacket,
} from "../vex-packet"

export type TransferReply = HostBoundPacket | ArrayBuffer | Uint8Array | AckType

export interface FileTransferIo {
  readonly isConnected: boolean
  readonly isClosing: boolean
  readonly writer: WritableStreamDefaultWriter<Uint8Array> | undefined
  readonly port: AdapterSerialPort | undefined
  readonly maxFileDownloadBytes: number
  writeDataAsync(
    rawData: DeviceBoundPacket | Uint8Array,
    timeout?: number
  ): Promise<TransferReply>
  emitWarning(message: string, details?: unknown): void
  chunkSize(windowSize: number): number
}

export interface ProgramUploadConnection {
  stopProgram(): Promise<LoadFileActionReplyD2HPacket | null>
  getSystemStatus(
    timeout?: number
  ): Promise<GetSystemStatusReplyD2HPacket | null>
  writeDataAsync(
    rawData: DeviceBoundPacket | Uint8Array,
    timeout?: number
  ): Promise<TransferReply>
  uploadFileToDeviceUnlocked(
    request: IFileWriteRequest,
    progressCallback?: (current: number, total: number) => void
  ): Promise<boolean>
}

export async function uploadProgram(
  connection: ProgramUploadConnection,
  iniConfig: ProgramIniConfig,
  binFileBuf: Uint8Array,
  coldFileBuf: Uint8Array | undefined,
  progressCallback: (state: string, current: number, total: number) => void
): Promise<boolean | undefined> {
  if ((await connection.stopProgram()) === null) return false

  const iniFileBuffer = new TextEncoder().encode(iniConfig.createIni())
  // VEXos added compressed file support in 1.0.5. Raw binaries are still
  // valid on newer versions and are the safe fallback when the version query
  // is unavailable.
  // System version queries identify the USB device, which may be a controller.
  // Compression support belongs to the Brain receiving the program.
  const systemVersion =
    (await connection.getSystemStatus(2000))?.systemVersion ?? null

  const canCompress =
    systemVersion !== null &&
    systemVersion.compare(VexFirmwareVersion.fromString("1.0.5")) >= 0

  const hotBuf = canCompress ? await gzipBytes(binFileBuf) : binFileBuf

  const coldBuf =
    coldFileBuf !== undefined && canCompress
      ? await gzipBytes(coldFileBuf)
      : coldFileBuf

  const basename = iniConfig.baseName

  const iniRequest = {
    filename: basename + ".ini",
    buf: iniFileBuffer,
    downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
    vendor: FileVendor.USER,
    autoRun: false,
  }

  const r1 = await connection.uploadFileToDeviceUnlocked(
    iniRequest,
    (current, total) => {
      progressCallback("INI", current, total)
    }
  )

  if (!r1) return false

  // let prjRequest = { filename: basename + '.prj', buf: prjfile, vid: FileVendor.USER, loadAddr: undefined, exttype: 0, linkedFile: undefined };
  // await this.uploadFileToDeviceAsync(prjRequest, onProgress);

  const coldRequest =
    coldBuf !== undefined
      ? {
          filename:
            iniConfig.libraryName ??
            generateProsColdLibraryName(
              iniConfig.libraryTemplates ?? ["kernel", "liblvgl"]
            ),
          buf: coldBuf,
          downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
          vendor: FileVendor.DEV2,
          loadAddress: iniConfig.libraryAddress,
          autoRun: false,
          exttype: "bin",
        }
      : undefined

  if (coldRequest != null && coldBuf != null) {
    const metadata = await connection.writeDataAsync(
      new GetFileMetadataH2DPacket(FileVendor.DEV2, coldRequest.filename, 0),
      // Allow the controller radio hop to complete before declaring a cache miss.
      2000
    )

    const coldCrc = PacketEncoder.getInstance().crcgen.crc32(coldBuf, 0)

    const coldIsPresent =
      metadata instanceof GetFileMetadataReplyD2HPacket &&
      metadata.file?.size === coldBuf.byteLength &&
      metadata.file.crc32 === coldCrc

    if (coldIsPresent) {
      progressCallback("COLD (cached)", coldBuf.byteLength, coldBuf.byteLength)
    } else {
      const r2 = await connection.uploadFileToDeviceUnlocked(
        coldRequest,
        (current, total) => {
          progressCallback("COLD", current, total)
        }
      )

      if (!r2) return false
    }
  }

  const after =
    iniConfig.after !== FileExitAction.EXIT_NONE || iniConfig.autorun
      ? iniConfig.after !== FileExitAction.EXIT_NONE
        ? iniConfig.after
        : FileExitAction.EXIT_RUN
      : FileExitAction.EXIT_NONE

  const binRequest = {
    filename: basename + ".bin",
    buf: hotBuf,
    downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
    vendor: FileVendor.USER,
    loadAddress: coldBuf != null ? iniConfig.programAddress : undefined,
    autoRun: after !== FileExitAction.EXIT_NONE,
    exitAction: after,
    exttype: "bin",
    linkedFile: coldRequest,
  }

  const r3 = await connection.uploadFileToDeviceUnlocked(
    binRequest,
    (current, total) => {
      progressCallback("BIN", current, total)
    }
  )

  return r3
}

export async function downloadFile(
  io: FileTransferIo,
  request: IFileBasicInfo,
  downloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
  progressCallback?: (current: number, total: number) => void
): Promise<Uint8Array> {
  if (!io.isConnected && io.writer === undefined) {
    throw new Error("Not connected")
  }

  const { filename, vendor, loadAddress, size } = request

  let nextAddress = loadAddress ?? USER_FLASH_USR_CODE_START

  const p1 = await io.writeDataAsync(
    new InitFileTransferH2DPacket(
      FileInitAction.READ,
      downloadTarget,
      vendor,
      FileInitOption.NONE,
      new Uint8Array(),
      nextAddress,
      filename,
      ""
    )
  )

  if (!(p1 instanceof InitFileTransferReplyD2HPacket))
    throw new Error("InitFileTransferH2DPacket failed")

  try {
    const fileSize = size ?? p1.fileSize

    if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
      throw new Error(`Invalid file size: ${fileSize}`)
    }

    if (fileSize > io.maxFileDownloadBytes) {
      throw new Error(
        `File size ${fileSize} exceeds the ${io.maxFileDownloadBytes}-byte download limit`
      )
    }

    const bufferChunkSize = io.chunkSize(p1.windowSize)
    let bufferOffset = 0
    const fileBuf = new Uint8Array(fileSize)

    progressCallback?.(0, fileSize)

    while (bufferOffset < fileSize) {
      const remaining = fileSize - bufferOffset

      let requestedSize = Math.min(
        0xffff,
        Math.min(bufferChunkSize, (remaining + 3) & ~3)
      )

      // ACK-less USB replies have 12 framing bytes. VEXos 1.1.5 can leave
      // exact 64-byte packet multiples buffered without a terminating packet.
      if (requestedSize >= 121 && (requestedSize + 12) % 64 === 0)
        requestedSize -= 4

      const p2 = await io.writeDataAsync(
        new ReadFileH2DPacket(nextAddress, requestedSize),
        3000
      )

      if (!(p2 instanceof ReadFileReplyD2HPacket))
        throw new Error("ReadFileReplyD2HPacket failed")

      if (
        p2.addr !== nextAddress ||
        p2.length <= 0 ||
        p2.length > requestedSize ||
        p2.buf.byteLength < p2.length
      ) {
        throw new Error("ReadFileReplyD2HPacket returned invalid data")
      }

      const received = Math.min(p2.length, remaining)
      fileBuf.set(new Uint8Array(p2.buf).subarray(0, received), bufferOffset)
      bufferOffset += received
      nextAddress += received
      progressCallback?.(bufferOffset, fileSize)
    }

    return fileBuf
  } finally {
    const exit = await io.writeDataAsync(
      new ExitFileTransferH2DPacket(FileExitAction.EXIT_HALT),
      30000
    )

    if (!(exit instanceof ExitFileTransferReplyD2HPacket)) {
      io.emitWarning("file download did not exit transfer mode cleanly", exit)
    }
  }
}

export async function uploadFile(
  io: FileTransferIo,
  request: IFileWriteRequest,
  progressCallback?: (current: number, total: number) => void
): Promise<boolean> {
  let {
    filename,
    buf,
    downloadTarget,
    vendor,
    loadAddress,
    exttype,
    autoRun,
    exitAction,
    linkedFile,
  } = request

  if (buf === undefined || (!io.isConnected && io.writer === undefined)) {
    return false
  }

  downloadTarget = downloadTarget ?? FileDownloadTarget.FILE_TARGET_QSPI
  vendor = vendor ?? FileVendor.USER

  let nextAddress = loadAddress ?? USER_FLASH_USR_CODE_START

  const p1 = await io.writeDataAsync(
    new InitFileTransferH2DPacket(
      FileInitAction.WRITE,
      downloadTarget,
      vendor,
      FileInitOption.OVERWRITE,
      buf,
      nextAddress,
      filename,
      exttype
    )
  )

  if (!(p1 instanceof InitFileTransferReplyD2HPacket))
    throw new Error("InitFileTransferH2DPacket failed")

  let exit: HostBoundPacket | ArrayBuffer | Uint8Array | AckType =
    AckType.NOT_CONNECTED

  try {
    if (linkedFile !== undefined) {
      const p3 = await io.writeDataAsync(
        new LinkFileH2DPacket(
          linkedFile.vendor ?? FileVendor.USER,
          linkedFile.filename,
          0
        ),
        10000
      )

      if (!(p3 instanceof LinkFileReplyD2HPacket))
        throw new Error("LinkFileH2DPacket failed")
    }

    const bufferChunkSize = io.chunkSize(p1.windowSize)
    let bufferOffset = 0
    progressCallback?.(0, buf.byteLength)

    while (bufferOffset < buf.byteLength) {
      const remaining = buf.byteLength - bufferOffset
      const chunkLength = Math.min(bufferChunkSize, remaining)
      const paddedLength = (chunkLength + 3) & ~3
      const tmpbuf = new Uint8Array(paddedLength)
      tmpbuf.set(buf.subarray(bufferOffset, bufferOffset + chunkLength))

      const packet = new WriteFileH2DPacket(nextAddress, tmpbuf)

      if (io.port?.fileWritesWithoutReply) {
        if (io.writer === undefined || io.isClosing)
          throw new Error("Not connected")

        await io.writer.write(packet.data)
      } else {
        const p2 = await io.writeDataAsync(packet, 3000)

        if (!(p2 instanceof WriteFileReplyD2HPacket))
          throw new Error("WriteFileReplyD2HPacket failed")
      }

      bufferOffset += chunkLength
      nextAddress += chunkLength
      progressCallback?.(bufferOffset, buf.byteLength)
    }
  } finally {
    exit = await io.writeDataAsync(
      new ExitFileTransferH2DPacket(
        exitAction ??
          (autoRun ? FileExitAction.EXIT_RUN : FileExitAction.EXIT_NONE)
      ),
      30000
    )
  }

  if (!(exit instanceof ExitFileTransferReplyD2HPacket)) {
    const reason =
      typeof exit === "number"
        ? (AckType[exit] ?? `code ${exit}`)
        : exit.constructor.name

    throw new Error(`Finishing ${filename} failed: ${reason}`)
  }

  return true
}
