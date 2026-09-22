import { VexFirmwareVersion } from "./vex-firmware-version"
import { type HostBoundPacket } from "./vex-packet"

const textDecoder = new TextDecoder("UTF-8")

export class PacketView extends DataView<ArrayBufferLike> {
  position = 0
  littleEndianDefault = true

  constructor(
    buffer: ArrayBufferLike,
    offset: number = 0,
    length: number = buffer.byteLength - offset
  ) {
    super(buffer, offset, length)
  }

  static fromPacket(packet: HostBoundPacket): PacketView {
    const view = new PacketView(
      packet.data.buffer,
      packet.data.byteOffset,
      packet.data.byteLength
    )
    view.position = packet.ackIndex + 1
    return view
  }

  nextInt8(): number {
    const result = this.getInt8(this.position)
    this.position += 1
    return result
  }

  nextUint8(): number {
    const result = this.getUint8(this.position)
    this.position += 1
    return result
  }

  nextInt16(littleEndian = this.littleEndianDefault): number {
    const result = this.getInt16(this.position, littleEndian)
    this.position += 2
    return result
  }

  nextUint16(littleEndian = this.littleEndianDefault): number {
    const result = this.getUint16(this.position, littleEndian)
    this.position += 2
    return result
  }

  nextInt32(littleEndian = this.littleEndianDefault): number {
    const result = this.getInt32(this.position, littleEndian)
    this.position += 4
    return result
  }

  nextUint32(littleEndian = this.littleEndianDefault): number {
    const result = this.getUint32(this.position, littleEndian)
    this.position += 4
    return result
  }

  nextString(length: number): string {
    const result = textDecoder.decode(
      new Uint8Array(this.buffer, this.byteOffset + this.position, length)
    )
    this.position += length
    return result
  }

  nextNTBS(length: number): string {
    // this length is different from the document
    const lastPosition = this.position
    const result = this.nextVarNTBS(length)
    this.position = lastPosition + length
    return result
  }

  nextVarNTBS(length: number): string {
    // this length is different from the document
    const lastPosition = this.position
    let byteLength = 0
    for (let i = 0; i < length; i++) {
      if (this.byteLength <= this.position) break
      const g = this.nextUint8()
      if (g === 0) break
      byteLength++
    }
    return textDecoder.decode(
      new Uint8Array(this.buffer, this.byteOffset + lastPosition, byteLength)
    )
  }

  nextVersion(reverse = false): VexFirmwareVersion {
    const result = VexFirmwareVersion.fromUint8Array(
      new Uint8Array(this.buffer, this.byteOffset, this.byteLength),
      this.position,
      reverse
    )
    this.position += 4
    return result
  }
}
