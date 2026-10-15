import {
  AckType,
  type DataArray,
  type IFileEntry,
  type IFileMetadata,
  type ISmartDeviceInfo,
} from "../vex"
import { VexFirmwareVersion } from "../vex-firmware-version"
import { PacketView } from "../vex-packet-view"
import { HostBoundPacket } from "./base"
import { PacketEncoder } from "./encoder"

export class Query1ReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 33
  static COMMAND_EXTENDED_ID = undefined

  // Query1 is a simple CDC reply. Its payload has no CDC2 ACK byte.
  static override isValidPacket(
    data: Uint8Array,
    headerLength: number
  ): boolean {
    return data.length >= headerLength + 10
  }

  joystickFlag1: number
  joystickFlag2: number
  brainFlag1: number
  brainFlag2: number
  bootloadFlag1: number
  bootloadFlag2: number

  constructor(data: DataArray) {
    super(data)

    this.joystickFlag1 = this.data[4]
    this.joystickFlag2 = this.data[5]
    this.brainFlag1 = this.data[6] // a.k.a vex version
    this.brainFlag2 = this.data[7]
    this.bootloadFlag1 = this.data[10]
    this.bootloadFlag2 = this.data[11]
  }
}

export class SystemVersionReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 164
  static COMMAND_EXTENDED_ID = undefined

  // SystemVersion is a simple CDC reply and has no CDC2 ACK byte.
  static override isValidPacket(
    data: Uint8Array,
    headerLength: number
  ): boolean {
    return data.length >= headerLength + 5
  }

  version: VexFirmwareVersion
  hardware: number

  constructor(data: DataArray) {
    super(data)

    this.version = new VexFirmwareVersion(
      this.data[4],
      this.data[5],
      this.data[6],
      this.data[8]
    )

    this.hardware = this.data[7]
  }
}

export class MatchModeReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 88
  static COMMAND_EXTENDED_ID = 193

  modebit: number

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)

    this.modebit = dataView.nextUint8()
  }
}

export class MatchStatusReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 88
  static COMMAND_EXTENDED_ID = 194

  rssi: number // a.k.a Signal Strength
  systemStatusBits: number
  radioStatusBits: number // a.k.a Data Quality
  fieldStatusBits: number
  matchClock: number
  brainBatteryPercent: number
  controllerBatteryPercent: number
  partnerControllerBatteryPercent: number
  pad: number
  buttons: number
  activeProgram: number
  radioType: number
  radioChannel: number
  radioSlot: number
  robotName: string
  controllerFlags: number
  rxSignalQuality: number

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)
    const n = this.ackIndex

    this.rssi = dataView.nextInt8()
    this.systemStatusBits = dataView.nextUint16()
    this.radioStatusBits = dataView.nextUint16()
    this.fieldStatusBits = dataView.nextUint8()
    this.matchClock = dataView.nextUint8()
    this.brainBatteryPercent = dataView.nextUint8()
    this.controllerBatteryPercent = dataView.nextUint8()
    this.partnerControllerBatteryPercent = dataView.nextUint8()
    this.pad = dataView.nextUint8()
    this.buttons = dataView.nextUint16()
    this.activeProgram = dataView.nextUint8()
    this.radioType = dataView.nextUint8()
    this.radioChannel = dataView.nextUint8()
    this.radioSlot = dataView.nextUint8()
    this.robotName = dataView.nextNTBS(10)
    this.controllerFlags = dataView.getUint8(n + 28)
    this.rxSignalQuality = dataView.getUint8(n + 29)

    let rawStr = new TextDecoder("UTF-8").decode(
      data.slice(n + 18, n + this.payloadSize + 28)
    )

    const endIdx = rawStr.indexOf("\0")

    if (endIdx > -1) {
      rawStr = rawStr.substr(0, endIdx)
    }

    this.robotName = rawStr
  }
}

export class FileControlReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 16
}

export class InitFileTransferReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 17
  windowSize: number
  fileSize: number
  crc32: number

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)

    this.windowSize = dataView.nextUint16()
    this.fileSize = dataView.nextUint32()
    this.crc32 = dataView.nextUint32()
  }
}

export class ExitFileTransferReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 18
}

export class WriteFileReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 19
}

export class ReadFileReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 20
  addr: number
  length: number
  buf: ArrayBuffer

  constructor(data: DataArray) {
    super(data)

    // V5 USB file-read replies omit the ACK byte and start with the address.
    // Retain compatibility with ACK-prefixed replies from other transports.
    const hasAck = this.ack === AckType.CDC2_ACK
    if (!hasAck) {
      this.ack = AckType.CDC2_ACK
      this.ackIndex--
    }
    const dataView = PacketView.fromPacket(this)

    this.addr = dataView.nextUint32(true)
    this.length = Math.max(0, this.payloadSize - (hasAck ? 8 : 7))
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)

    this.buf = bytes.slice(dataView.position, dataView.position + this.length)
      .buffer as ArrayBuffer
  }

  static isValidPacket(data: Uint8Array, n: number): boolean {
    const size = PacketEncoder.getInstance().getPayloadSize(data)
    return data[n + 1] === AckType.CDC2_ACK ? size > 8 : size > 7
  }
}

export class LinkFileReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 21
}

export class GetDirectoryFileCountReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 22
  count: number

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)

    this.count = dataView.nextUint16()
  }
}

export class GetDirectoryEntryReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 23

  file?: IFileEntry

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)

    if (this.payloadSize > 4) {
      this.file = {
        index: dataView.nextUint8(),
        size: dataView.nextUint32(),
        loadAddress: dataView.nextUint32(),
        crc32: dataView.nextUint32(),
        type: dataView.nextString(4),
        timestamp: dataView.nextUint32() + PacketEncoder.J2000_EPOCH,
        version: dataView.nextVersion(),
        filename: dataView.nextNTBS(32),
      }
    }
  }
}

export class LoadFileActionReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 24
}

export class GetFileMetadataReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 25

  file?: IFileMetadata

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)
    dataView.nextUint8()

    if (this.payloadSize > 4) {
      this.file = {
        size: dataView.nextUint32(),
        loadAddress: dataView.nextUint32(),
        crc32: dataView.nextUint32(),
        type: dataView.nextString(4),
        timestamp: dataView.nextUint32() + PacketEncoder.J2000_EPOCH,
        version: dataView.nextVersion(),
      }
    }
  }
}

export class SetFileMetadataReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 26
}

export class EraseFileReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 27
}

export class GetProgramSlotInfoReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 28
  requestedSlot: number
  slot: number

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)

    this.slot = dataView.nextUint8()
    this.requestedSlot = dataView.nextUint8()
  }
}

export class FileClearUpReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 30
}

export class FileFormatReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 31
}

export class GetSystemFlagsReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 32
  flags: number
  radioSearching: boolean
  radioQuality?: number
  controllerBatteryPercent?: number
  partnerControllerBatteryPercent?: number
  battery?: number
  currentProgram: number

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)

    this.radioSearching = false
    this.currentProgram = 0

    this.flags = dataView.nextUint32()
    const hasPartner = (8192 & this.flags) !== 0
    const hasRadio = (1536 & this.flags) === 1536

    const byte1 = dataView.nextUint8()
    const byte2 = dataView.nextUint8()

    if (this.payloadSize === 11) {
      this.battery = 8 * (byte1 & 0x0f)

      if ((this.flags & 0x100) !== 0 || hasRadio)
        this.controllerBatteryPercent = 8 * ((byte1 >> 4) & 0x0f)

      if (hasRadio) this.radioQuality = 8 * (byte2 & 0x0f)
      this.radioSearching = (this.flags & 0x600) === 0x200

      if (hasPartner)
        this.partnerControllerBatteryPercent = 8 * ((byte2 >> 4) & 0x0f)

      this.currentProgram = dataView.nextUint8()

      if (this.battery != null && this.battery > 100) this.battery = 100

      if (
        this.controllerBatteryPercent != null &&
        this.controllerBatteryPercent > 100
      )
        this.controllerBatteryPercent = 100

      if (this.radioQuality != null && this.radioQuality > 100)
        this.radioQuality = 100

      if (
        this.partnerControllerBatteryPercent != null &&
        this.partnerControllerBatteryPercent > 100
      )
        this.partnerControllerBatteryPercent = 100
    }
  }
}

export class GetDeviceStatusReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 33
  count: number
  devices: ISmartDeviceInfo[]

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)

    this.count = dataView.nextUint8()
    this.devices = []

    for (let i = 0; i < this.count; i++) {
      this.devices.push({
        port: dataView.nextUint8(),
        type: dataView.nextUint8(),
        status: dataView.nextUint8(),
        betaversion: dataView.nextUint8(),
        version: dataView.nextUint16(),
        bootversion: dataView.nextUint16(),
      })
    }
  }
}

export class GetSystemStatusReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 34

  systemVersion: VexFirmwareVersion
  cpu0Version: VexFirmwareVersion
  cpu1Version: VexFirmwareVersion
  nxpVersion: VexFirmwareVersion
  touchVersion: VexFirmwareVersion
  uniqueId: number
  sysflags: number[]
  eventBrain: boolean
  romBootloaderActive: boolean
  ramBootloaderActive: boolean
  goldenVersion: VexFirmwareVersion

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)

    dataView.nextUint8()

    this.systemVersion = dataView.nextVersion()
    this.cpu0Version = dataView.nextVersion()
    this.cpu1Version = dataView.nextVersion()
    this.touchVersion = dataView.nextVersion(true)

    this.uniqueId = 1234
    this.sysflags = [0, 0, 0, 0, 0, 0, 0]
    this.goldenVersion = VexFirmwareVersion.allZero()
    this.nxpVersion = VexFirmwareVersion.allZero()
    this.eventBrain = false
    this.romBootloaderActive = false
    this.ramBootloaderActive = false

    if (this.payloadSize > 25) {
      this.uniqueId = dataView.nextUint32()

      this.sysflags = [
        dataView.nextUint8(),
        dataView.nextUint8(),
        dataView.nextUint8(),
        dataView.nextUint8(),
        dataView.nextUint8(),
        0,
        dataView.nextUint8(),
      ]

      this.eventBrain = (1 & this.sysflags[6]) !== 0
      this.romBootloaderActive = (2 & this.sysflags[6]) !== 0
      this.ramBootloaderActive = (4 & this.sysflags[6]) !== 0

      dataView.nextUint16()

      this.goldenVersion = dataView.nextVersion()
    }

    if (this.payloadSize > 37) {
      this.nxpVersion = dataView.nextVersion()
    }
  }
}

export class GetFdtStatusReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 35
  count: number
  status: unknown[]

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)

    this.count = dataView.nextUint8()
    this.status = []

    for (let i = 0; i < this.count; i++) {
      this.status.push({
        index: dataView.nextUint8(),
        type: dataView.nextUint8(),
        status: dataView.nextUint8(),
        betaversion: dataView.nextUint8(),
        version: dataView.nextUint16(),
        bootversion: dataView.nextUint16(),
      })
    }
  }
}

export class GetLogCountReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 36
  count: number

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)

    dataView.nextUint8()

    this.count = dataView.nextUint32()
  }
}

export class ReadLogPageReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 37
  offset: number
  count: number
  entries: unknown[]

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)
    const n = this.ackIndex

    const size = dataView.nextUint8()
    this.offset = dataView.nextUint32()
    this.count = dataView.nextUint16()
    this.entries = []

    let j = n + 8

    for (let i = 0; i < this.count; i++) {
      this.entries.push({
        code: dataView.getUint8(j),
        type: dataView.getUint8(j + 1),
        desc: dataView.getUint8(j + 2),
        spare: dataView.getUint8(j + 3),
        time: dataView.getUint32(j + 4, true),
      })

      j += size
    }
  }
}

export class GetRadioStatusReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 38
  device: number // unsure
  quality: number
  strength: number
  channel: number
  timeslot: number // time delay?

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)
    const n = this.ackIndex

    this.device = dataView.nextUint8()
    this.quality = dataView.nextUint16()
    this.strength = dataView.nextInt16()
    this.channel = this.data[n + 6]
    this.timeslot = this.data[n + 7]
  }
}

export class UserFifoReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 39

  channel: number
  buf: Uint8Array

  constructor(data: DataArray) {
    super(data)

    const view = PacketView.fromPacket(this)
    this.channel = view.nextUint8()
    const length = Math.max(0, this.payloadSize - 5)
    this.buf = this.data.subarray(view.position, view.position + length)
  }
}

/** @deprecated Use {@link UserFifoReplyD2HPacket}. */
export class GetUserDataReplyD2HPacket extends UserFifoReplyD2HPacket {}

export class ScreenCaptureReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 40
}

// export class UserProgramControlReplyD2HPacket extends HostBoundPacket {
//     static COMMAND_ID = 86;
//     static COMMAND_EXTENDED_ID = 41;
// }

export class SendDashTouchReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 42
}

export class SelectDashReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 43
}

export class EnableDashReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 44
}

export class DisableDashReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 45
}

export class ReadKeyValueReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 46
  value: string

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)

    this.value = dataView.nextVarNTBS(255)
  }
}

export class WriteKeyValueReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 47
}

export class GetSlot1to4InfoReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 49
  slotFlags: number
  slots: unknown[]

  constructor(data: DataArray, start: number = 1) {
    super(data)

    const dataView = PacketView.fromPacket(this)

    this.slotFlags = dataView.nextUint8()
    this.slots = []

    for (let i = 0; i < 4; i++) {
      const hasData = (this.slotFlags & Math.pow(2, start - 1 + i)) !== 0

      if (!hasData) continue

      const iconNum = dataView.nextUint16()
      const nameLen = dataView.nextUint8()
      const name = dataView.nextString(nameLen)

      this.slots.push({
        slot: start + i,
        icon: iconNum,
        name,
      })
    }
  }
}

export class GetSlot5to8InfoReplyD2HPacket extends GetSlot1to4InfoReplyD2HPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 50
  slotStartIndex = 5

  constructor(data: DataArray) {
    super(data, 5)
  }
}

export class FactoryStatusReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 241
  status: number
  percent: number

  constructor(data: DataArray) {
    super(data)

    const dataView = PacketView.fromPacket(this)

    this.status = dataView.nextUint8()
    this.percent = dataView.nextUint8()
  }
}

export class FactoryEnableReplyD2HPacket extends HostBoundPacket {
  static COMMAND_ID = 86
  static COMMAND_EXTENDED_ID = 255
}
