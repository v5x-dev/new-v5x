import type { IPacketCallback } from "./vex"
import { PacketEncoder } from "./vex-packet"
import { ReceiveBuffer } from "./receive-buffer"

export interface PacketReaderOptions {
  readData: (cache: ReceiveBuffer, expectedSize: number) => Promise<void>
  shiftCallback: (
    commandId: number,
    commandExtendedId: number | undefined
  ) => IPacketCallback | undefined
  reportWarning: (message: string, details?: unknown) => void
  close: () => Promise<void>
}

/** Read, resynchronize, validate, and dispatch host-bound packets. */
export async function runPacketReader({
  readData,
  shiftCallback,
  reportWarning,
  close,
}: PacketReaderOptions): Promise<void> {
  const encoder = PacketEncoder.getInstance()
  const cache = new ReceiveBuffer()

  for (;;) {
    let consumed = 0
    try {
      await readData(cache, 5)

      while (!encoder.validateHeader(cache.bytes)) {
        const bytes = cache.bytes
        const nextHeader = findHeader(bytes, 1)
        if (nextHeader >= 0) {
          cache.discard(nextHeader)
        } else {
          cache.discard(
            bytes[bytes.length - 1] === PacketEncoder.HEADER_TO_HOST[0]
              ? -1
              : bytes.length
          )
        }
        await readData(cache, 5)
      }

      const payloadSize = encoder.getPayloadSize(cache.bytes)
      const headerLength = encoder.getHostHeaderLength(cache.bytes)
      const totalSize = headerLength + payloadSize
      await readData(cache, totalSize)
      consumed = totalSize

      const packet = cache.copy(totalSize)
      const commandId = packet[2]
      const extended = commandId === 86 || commandId === 88
      const commandExtendedId = extended ? packet[headerLength] : undefined
      const ack = packet[headerLength + 1]

      if (extended && !encoder.validateMessageCdc(packet)) {
        reportWarning("discarding a reply with an invalid CDC CRC", {
          commandId,
          commandExtendedId,
          ack,
        })
        continue
      }

      const callback = shiftCallback(commandId, commandExtendedId)
      if (callback === undefined) {
        reportWarning("received a reply with no matching request", {
          commandId,
          commandExtendedId,
          ack,
        })
        continue
      }

      const packetType = encoder.getPacketType(
        callback.wantedCommandId,
        callback.wantedCommandExId
      )
      try {
        if (
          callback.wantedCommandId === undefined ||
          packetType === undefined
        ) {
          if (callback.wantedCommandId !== undefined) {
            reportWarning(
              "no packet class is registered for the wanted command",
              {
                commandId: callback.wantedCommandId,
                commandExtendedId: callback.wantedCommandExId,
              }
            )
          }
          callback.callback(packet.slice().buffer)
        } else if (packetType.isValidPacket(packet, headerLength)) {
          callback.callback(new packetType(packet))
        } else {
          reportWarning("reply failed packet validation; delivering its ack", {
            commandId,
            commandExtendedId,
            ack,
          })
          callback.callback(ack)
        }
      } catch (error) {
        reportWarning("reply could not be decoded; delivering its ack", {
          commandId,
          commandExtendedId,
          ack,
          error,
        })
        callback.callback(ack)
      } finally {
        clearTimeout(callback.timeout)
      }
    } catch (error) {
      reportWarning("reader loop stopped by a read error", {
        error,
        pendingBytes: cache.bytes.slice(),
      })
      await close()
      return
    } finally {
      cache.discard(consumed)
    }
  }
}

function findHeader(bytes: Uint8Array, from: number): number {
  for (let index = from; index + 1 < bytes.length; index++) {
    if (
      bytes[index] === PacketEncoder.HEADER_TO_HOST[0] &&
      bytes[index + 1] === PacketEncoder.HEADER_TO_HOST[1]
    ) {
      return index
    }
  }
  return -1
}
