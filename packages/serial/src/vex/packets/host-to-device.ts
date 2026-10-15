import {
  type FileDownloadTarget,
  type FileExitAction,
  FileInitAction,
  type FileInitOption,
  type FileLoadAction,
  type FileVendor,
  type IFileMetadata,
  type MatchMode,
  type SlotNumber,
  type SelectDashScreen,
  USER_FIFO_MAX_WRITE_SIZE,
  UserFifoChannel,
} from "../vex"
import { VexFirmwareVersion } from "../vex-firmware-version"
import { DeviceBoundPacket, Packet } from "./base"
import { PacketEncoder } from "./encoder"

const textEncoder = new TextEncoder()

function encodeFixedText(
  value: string,
  field: string,
  maxBytes: number
): Uint8Array {
  if (value.includes("\0")) {
    throw new TypeError(`${field} must not contain NUL characters`)
  }

  const encoded = textEncoder.encode(value)

  if (encoded.byteLength > maxBytes) {
    throw new RangeError(`${field} must be at most ${maxBytes} UTF-8 bytes`)
  }

  return encoded
}

function filePayload(
  first: number,
  second: number,
  filename: string
): Uint8Array {
  const payload = new Uint8Array(26)
  payload[0] = first
  payload[1] = second
  payload.set(encodeFixedText(filename, "Filename", 24), 2)
  return payload
}

export class Query1H2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 33
  static COMMAND_EXTENDED_ID = undefined

  constructor() {
    super(undefined)
  }
}

export class SystemVersionH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 164
  static COMMAND_EXTENDED_ID = undefined

  constructor() {
    super(undefined)
  }
}

export class UpdateMatchModeH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 88
  static COMMAND_EXTENDED_ID = 193

  constructor(mode: MatchMode, matchClock: number) {
    let bit1

    switch (mode) {
      case "autonomous":
        bit1 = 10
        break
      case "driver":
        bit1 = 8
        break
      case "disabled":
        bit1 = 11
    }

    const payload = new Uint8Array(5)
    const view = new DataView(payload.buffer)
    payload[0] = (15 & bit1) >>> 0

    view.setUint32(1, matchClock, true)

    super(payload)
  }
}

export class GetMatchStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 88
  static COMMAND_EXTENDED_ID = 194

  constructor() {
    super(undefined)
  }
}

export class GetRadioModeH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 88
  static COMMAND_EXTENDED_ID = 65

  constructor(mode: number) {
    const payload = new Uint8Array(1)
    payload[0] = mode

    super(payload)
  }
}

export class FileControlH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 16

  constructor(a: number, b: number) {
    const payload = new Uint8Array(2)
    payload.set([a, b], 0)

    super(payload)
  }
}

export class InitFileTransferH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 17

  constructor(
    operation: FileInitAction,
    target: FileDownloadTarget,
    vendor: FileVendor,
    options: FileInitOption,
    binary: Uint8Array,
    addr: number,
    name: string,
    type?: string,
    version: VexFirmwareVersion = new VexFirmwareVersion(1, 0, 0, 0)
  ) {
    const payload = new Uint8Array(52)
    const view = new DataView(payload.buffer)

    view.setUint8(0, operation)
    view.setUint8(1, target)
    view.setUint8(2, vendor)
    view.setUint8(3, options)
    view.setUint32(4, binary.length, true)
    view.setUint32(8, addr, true)

    view.setUint32(
      12,
      operation === FileInitAction.WRITE
        ? Packet.ENCODER.crcgen.crc32(binary, 0)
        : 0,
      true
    )

    const reResult = /(?:\.([^.]+))?$/.exec(name)
    let ext = reResult?.[1] ?? ""
    // files with gz extension are also type bin
    ext = ext === "gz" ? "bin" : ext
    payload.set(encodeFixedText(type ?? ext, "File type", 4), 16)

    const timestamp = ((Date.now() / 1000) >>> 0) - PacketEncoder.J2000_EPOCH
    view.setUint32(20, timestamp, true)

    payload.set(version.toUint8Array(), 24)

    // filename
    payload.set(encodeFixedText(name, "Filename", 24), 28)

    super(payload)
  }
}

export class ExitFileTransferH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 18

  constructor(action: FileExitAction) {
    const payload = new Uint8Array(1)
    payload[0] = action

    super(payload)
  }
}

export class WriteFileH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 19

  constructor(addr: number, buf: Uint8Array) {
    const payload = new Uint8Array(4 + buf.length)
    const view = new DataView(payload.buffer)
    view.setUint32(0, addr, true)
    payload.set(buf, 4)

    super(payload)
  }
}

export class ReadFileH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 20

  constructor(addr: number, size: number) {
    const payload = new Uint8Array(6)
    const view = new DataView(payload.buffer)
    view.setUint32(0, addr, true)
    view.setUint16(4, size, true)

    super(payload)
  }
}

export class LinkFileH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 21

  constructor(vendor: FileVendor, fileName: string, options: number) {
    super(filePayload(vendor, options, fileName))
  }
}

export class GetDirectoryFileCountH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 22

  constructor(vendor: FileVendor) {
    const payload = new Uint8Array(2)
    payload.set([vendor, 0], 0)

    super(payload)
  }
}

export class GetDirectoryEntryH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 23

  constructor(index: number) {
    const payload = new Uint8Array(2)
    payload.set([index, 0], 0)

    super(payload)
  }
}

export class LoadFileActionH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 24

  constructor(
    vendor: FileVendor,
    actionId: FileLoadAction,
    fileNameOrSlotNumber: SlotNumber | string
  ) {
    let fileName

    if (typeof fileNameOrSlotNumber === "string") {
      fileName = fileNameOrSlotNumber
    } else {
      fileName = "___s_" + (fileNameOrSlotNumber - 1) + ".bin"
    }

    super(filePayload(vendor, actionId, fileName))
  }
}

export class GetFileMetadataH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 25

  constructor(vendor: FileVendor, fileName: string, options: number) {
    super(filePayload(vendor, options, fileName))
  }
}

export class SetFileMetadataH2DPacket extends DeviceBoundPacket {
  // DOES NOT WORK
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 26

  constructor(
    vendor: FileVendor,
    fileName: string,
    fileInfo: IFileMetadata,
    options: number
  ) {
    const encodedName = encodeFixedText(fileName, "Filename", 24)
    const encodedType = encodeFixedText(fileInfo.type, "File type", 4)

    const payload = new Uint8Array(42)
    const view = new DataView(payload.buffer)
    view.setUint8(0, vendor)
    view.setUint8(1, options)
    view.setUint32(2, fileInfo.loadAddress, true)
    payload.set(encodedType.subarray(0, 4), 6)
    const timestamp = fileInfo.timestamp - PacketEncoder.J2000_EPOCH
    view.setUint32(10, timestamp, true)
    payload.set(fileInfo.version.toUint8Array(), 14)
    payload.set(encodedName, 18)

    super(payload)
  }
}

export class EraseFileH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 27

  constructor(vendor: FileVendor, fileName: string) {
    super(filePayload(vendor, 128, fileName))
  }
}

export class GetProgramSlotInfoH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 28

  constructor(vendor: FileVendor, fileName: string) {
    super(filePayload(vendor, 0, fileName))
  }
}

export class FileClearUpH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 30

  constructor(vendor: FileVendor) {
    const payload = new Uint8Array(2)
    payload.set([vendor, 0], 0)

    super(payload)
  }
}

export class FileFormatH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 31

  constructor() {
    const payload = new Uint8Array(4)
    payload.set([68, 67, 66, 65], 0)

    super(payload)
  }
}

export class GetSystemFlagsH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 32
}

export class GetDeviceStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 33

  constructor() {
    super(undefined)
  }
}

export class GetSystemStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 34

  constructor() {
    super(undefined)
  }
}

export class GetFdtStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 35

  constructor() {
    super(undefined)
  }
}

export class GetLogCountH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 36

  constructor() {
    super(undefined)
  }
}

export class ReadLogPageH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 37

  constructor(offset: number, count: number) {
    const payload = new Uint8Array(8)
    const view = new DataView(payload.buffer)
    view.setUint32(0, offset, true)
    view.setUint32(4, count, true)

    super(payload)
  }
}

export class GetRadioStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 38

  constructor() {
    super(undefined)
  }
}

export class UserFifoH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 39

  constructor(channel: UserFifoChannel, write?: Uint8Array) {
    const length = write?.byteLength ?? 0

    if (length > USER_FIFO_MAX_WRITE_SIZE) {
      throw new RangeError(
        `User FIFO writes must be at most ${USER_FIFO_MAX_WRITE_SIZE} bytes`
      )
    }

    const payload = new Uint8Array(2 + length)
    payload[0] = channel
    payload[1] = length
    if (write !== undefined) payload.set(write, 2)

    super(payload)
  }
}

/** @deprecated Use {@link UserFifoH2DPacket}. */
export class GetUserDataH2DPacket extends UserFifoH2DPacket {
  constructor(write?: Uint8Array) {
    super(UserFifoChannel.STDOUT, write)
  }
}

export class ScreenCaptureH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 40

  constructor(e: number) {
    const payload = new Uint8Array(1)
    payload[0] = e

    super(payload)
  }
}

export class SendDashTouchH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 42

  constructor(x: number, y: number, press: boolean) {
    const payload = new Uint8Array(6)
    const view = new DataView(payload.buffer)
    view.setUint16(0, x, true)
    view.setUint16(2, y, true)
    view.setUint16(4, press ? 1 : 0, true)

    super(payload)
  }
}

export class SelectDashH2DPacket extends DeviceBoundPacket {
  // UNSURE
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 43

  /** @param port untested */
  constructor(screen: number | SelectDashScreen, port: number) {
    const payload = new Uint8Array(2)
    payload[0] = screen
    payload[1] = port

    super(payload)
  }
}

export class EnableDashH2DPacket extends DeviceBoundPacket {
  // UNSURE
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 44

  constructor(unknown1?: number) {
    if (unknown1 === undefined) {
      super(undefined)
    } else {
      const payload = new Uint8Array(1)
      payload[0] = unknown1

      super(payload)
    }
  }
}

export class DisableDashH2DPacket extends DeviceBoundPacket {
  // UNSURE
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 45

  constructor() {
    super(undefined)
  }
}

export class ReadKeyValueH2DPacket extends DeviceBoundPacket {
  // UNSURE
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 46

  constructor(key: string) {
    const payload = new Uint8Array(32)
    payload.set(encodeFixedText(key, "Key", 31), 0)

    super(payload)
  }
}

export class WriteKeyValueH2DPacket extends DeviceBoundPacket {
  // UNSURE
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 47

  constructor(key: string, value: string) {
    const strk = encodeFixedText(key, "Key", 31)
    const strv = encodeFixedText(value, "Value", 0x7fff)

    if (strk.byteLength + strv.byteLength + 20 > 0x7fff) {
      throw new RangeError("Key and value are too large for a protocol packet")
    }

    const payload = new Uint8Array(strk.length + strv.length + 20)
    payload.set(strk, 0)
    payload.set(strv, strk.length + 1)

    super(payload)
  }
}

export class GetSlot1to4InfoH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 49

  constructor() {
    super(undefined)
  }
}

export class GetSlot5to8InfoH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 50

  constructor() {
    super(undefined)
  }
}

export class FactoryStatusH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 241
}

export class FactoryEnableH2DPacket extends DeviceBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 255

  constructor() {
    const payload = new Uint8Array(4)
    payload.set([77, 76, 75, 74], 0)

    super(payload)
  }
}
