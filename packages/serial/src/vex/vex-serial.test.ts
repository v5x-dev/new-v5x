import { expect, test } from "bun:test"
import { AckType, UserFifoChannel, USER_FIFO_MAX_WRITE_SIZE } from "./vex"
import type { IFileWriteRequest } from "./vex"
import { ProgramIniConfig } from "./vex-ini-config"
import {
  PacketEncoder,
  ExitFileTransferReplyD2HPacket,
  InitFileTransferReplyD2HPacket,
  ExitFileTransferH2DPacket,
  InitFileTransferH2DPacket,
  GetFileMetadataH2DPacket,
  GetFileMetadataReplyD2HPacket,
  ReadKeyValueH2DPacket,
  ReadKeyValueReplyD2HPacket,
  ReadFileH2DPacket,
  ReadFileReplyD2HPacket,
  UserFifoH2DPacket,
  UserFifoReplyD2HPacket,
} from "./vex-packet"
import { V5SerialConnection } from "./vex-connection"
import { VexFirmwareVersion } from "./vex-firmware-version"
import { V5SerialDevice } from "./vex-device"
import { V5UserProgramTerminal } from "./vex-terminal"

function reply(
  command: number,
  extendedCommand: number,
  body: Uint8Array,
  ack: AckType = AckType.CDC2_ACK
): Uint8Array {
  const payloadSize = body.byteLength + 4
  const headerLength = payloadSize >= 128 ? 5 : 4
  const packet = new Uint8Array(headerLength + payloadSize)
  packet.set([0xaa, 0x55, command], 0)

  if (headerLength === 5) {
    packet[3] = 0x80 | (payloadSize >>> 8)
    packet[4] = payloadSize & 0xff
  } else {
    packet[3] = payloadSize
  }

  packet[headerLength] = extendedCommand
  packet[headerLength + 1] = ack
  packet.set(body, headerLength + 2)

  const crc = PacketEncoder.getInstance().crcgen.crc16(
    packet.subarray(0, -2),
    0
  )

  packet[packet.length - 2] = crc >>> 8
  packet[packet.length - 1] = crc & 0xff
  return packet
}

test("user FIFO packets encode channels and enforce the write limit", () => {
  const data = new Uint8Array([1, 2, 3])
  const packet = new UserFifoH2DPacket(UserFifoChannel.STDIN, data)

  expect(packet.data.slice(4, 11)).toEqual(
    Uint8Array.from([86, 39, 5, UserFifoChannel.STDIN, 3, 1, 2])
  )

  expect(
    () =>
      new UserFifoH2DPacket(
        UserFifoChannel.STDIN,
        new Uint8Array(USER_FIFO_MAX_WRITE_SIZE + 1)
      )
  ).toThrow("User FIFO writes")
})

test("user FIFO replies expose only the channel payload", () => {
  const packet = new UserFifoReplyD2HPacket(
    reply(86, 39, Uint8Array.from([UserFifoChannel.STDOUT, 65, 0, 66, 0]))
  )

  expect(packet.channel).toBe(UserFifoChannel.STDOUT)
  expect(packet.buf).toEqual(Uint8Array.from([65, 0, 66, 0]))
})

test("packet string fields decode UTF-8", () => {
  const packet = new ReadKeyValueReplyD2HPacket(
    reply(86, 46, new TextEncoder().encode("pré\0"))
  )

  expect(packet.value).toBe("pré")
})

test("file-read replies expose the address and exact data bytes", () => {
  const body = new Uint8Array(7)
  new DataView(body.buffer).setUint32(0, 0x03800000, true)
  body.set([1, 2, 3], 4)

  const packet = new ReadFileReplyD2HPacket(reply(86, 20, body))

  expect(packet.addr).toBe(0x03800000)
  expect(packet.length).toBe(3)
  expect(new Uint8Array(packet.buf)).toEqual(Uint8Array.from([1, 2, 3]))
})

test("the packet reader resynchronizes after garbage and parses large frames", async () => {
  class TestConnection extends V5SerialConnection {
    read(): Promise<void> {
      return this.startReader()
    }
  }

  let controller: ReadableStreamDefaultController<Uint8Array> | undefined

  const readable = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
  })

  const connection = new TestConnection({} as never)
  connection.reader = readable.getReader()

  connection.writer = {
    write: async () => {},
    close: async () => {},
    releaseLock: () => {},
  } as unknown as WritableStreamDefaultWriter<Uint8Array>

  const request = connection.writeDataAsync(new ReadKeyValueH2DPacket("key"))
  const reading = connection.read()
  const body = new Uint8Array(124)
  body.set(new TextEncoder().encode("ok\0"))
  const largeReply = reply(86, 46, body)
  controller?.enqueue(Uint8Array.from([9, 8, 7, ...largeReply]))

  const result = await request
  expect(result).toBeInstanceOf(ReadKeyValueReplyD2HPacket)
  expect((result as ReadKeyValueReplyD2HPacket).value).toBe("ok")

  await connection.close()
  await reading
})

test("accepts a fragmented V5 Brain Query1 reply without a CDC2 ACK", async () => {
  class TestConnection extends V5SerialConnection {
    read(): Promise<void> {
      return this.startReader()
    }
  }

  let controller: ReadableStreamDefaultController<Uint8Array> | undefined

  const readable = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
  })

  const connection = new TestConnection({} as never)
  connection.reader = readable.getReader()

  connection.writer = {
    write: async () => {},
    close: async () => {},
    releaseLock: () => {},
  } as unknown as WritableStreamDefaultWriter<Uint8Array>

  const request = connection.query1()
  const reading = connection.read()
  controller?.enqueue(Uint8Array.from([170]))

  controller?.enqueue(
    Uint8Array.from([85, 33, 10, 0, 0, 1, 1, 5, 0, 0, 0, 0, 6])
  )

  const result = await request
  expect(result?.brainFlag1).toBe(1)
  await connection.close()
  await reading
})

test.each([null, "1.0.4", "1.0.5"])(
  "reuses cold library with Brain firmware %s",
  async (brainVersion) => {
    const cold = Uint8Array.from([1, 2, 3, 4])
    const storedCold =
      brainVersion === "1.0.5"
        ? new Uint8Array(
            Bun.spawnSync({
              cmd: [
                "python3",
                "-c",
                "import sys,gzip;sys.stdout.buffer.write(gzip.compress(sys.stdin.buffer.read(),mtime=0))",
              ],
              stdin: cold,
            }).stdout
          )
        : cold
    const crc = PacketEncoder.getInstance().crcgen.crc32(storedCold, 0)

    class TransferConnection extends V5SerialConnection {
      uploaded: string[] = []
      metadataCrc = crc

      override async stopProgram() {
        return {} as NonNullable<
          Awaited<ReturnType<V5SerialConnection["stopProgram"]>>
        >
      }

      override async getSystemStatus() {
        return brainVersion === null
          ? null
          : ({
              systemVersion: VexFirmwareVersion.fromString(brainVersion),
            } as NonNullable<
              Awaited<ReturnType<V5SerialConnection["getSystemStatus"]>>
            >)
      }

      override async getSystemVersion(): Promise<never> {
        throw new Error("Upload must query the Brain, not the USB device")
      }

      override async writeDataAsync(
        packet: Parameters<V5SerialConnection["writeDataAsync"]>[0],
        timeout?: number
      ): Promise<Awaited<ReturnType<V5SerialConnection["writeDataAsync"]>>> {
        expect(timeout).toBe(2000)
        if (!(packet instanceof GetFileMetadataH2DPacket)) {
          throw new Error("Unexpected packet")
        }

        const body = new Uint8Array(25)
        const view = new DataView(body.buffer)
        view.setUint8(0, 24)
        view.setUint32(1, storedCold.byteLength, true)
        view.setUint32(9, this.metadataCrc, true)
        return new GetFileMetadataReplyD2HPacket(reply(86, 25, body))
      }

      override async uploadFileToDeviceUnlocked(request: IFileWriteRequest) {
        this.uploaded.push(request.filename)
        return true
      }
    }

    const connection = new TransferConnection({} as never)
    const ini = new ProgramIniConfig()
    ini.libraryName = "cold-library"
    const progress: string[] = []

    const upload = () =>
      connection.uploadProgramToDevice(
        ini,
        Uint8Array.from([5, 6]),
        cold,
        (state) => {
          progress.push(state)
        }
      )

    expect(await upload()).toBe(true)
    expect(connection.uploaded).toEqual(["slot_1.ini", "slot_1.bin"])
    expect(progress).toContain("COLD (cached)")

    connection.uploaded = []
    connection.metadataCrc = crc ^ 1
    expect(await upload()).toBe(true)

    expect(connection.uploaded).toEqual([
      "slot_1.ini",
      "cold-library",
      "slot_1.bin",
    ])
  }
)

test("closing a connection resolves pending requests", async () => {
  const connection = new V5SerialConnection({} as never)

  connection.writer = {
    write: async () => {},
    close: async () => {},
    releaseLock: () => {},
  } as unknown as WritableStreamDefaultWriter<Uint8Array>

  const pending = connection.writeDataAsync(new Uint8Array([1]), 1000)
  await connection.close()
  expect(await pending).toBe(AckType.NOT_CONNECTED)
})

test("same-command requests wait for the previous reply or timeout", async () => {
  const connection = new V5SerialConnection({} as never)
  const writes: Uint8Array[] = []

  connection.writer = {
    write: async (data: Uint8Array) => {
      writes.push(data)
    },
    close: async () => {},
    releaseLock: () => {},
  } as unknown as WritableStreamDefaultWriter<Uint8Array>

  const first = connection.writeDataAsync(new ReadKeyValueH2DPacket("first"), 1)

  const second = connection.writeDataAsync(
    new ReadKeyValueH2DPacket("second"),
    100
  )

  expect(await first).toBe(AckType.TIMEOUT)
  for (let i = 0; i < 100 && writes.length < 2; i++) await Bun.sleep(0)
  expect(writes).toHaveLength(2)

  await connection.close()
  expect(await second).toBe(AckType.NOT_CONNECTED)
})

test("file downloads avoid exact USB reply packet boundaries", async () => {
  const source = Uint8Array.from({ length: 500 }, (_, index) => index)
  const requests: number[] = []
  class TransferConnection extends V5SerialConnection {
    override get isConnected(): boolean {
      return true
    }
    override async writeDataAsync(
      packet: Parameters<V5SerialConnection["writeDataAsync"]>[0]
    ): Promise<Awaited<ReturnType<V5SerialConnection["writeDataAsync"]>>> {
      if (packet instanceof InitFileTransferH2DPacket) {
        const body = new Uint8Array(10)
        const view = new DataView(body.buffer)
        view.setUint16(0, 512, true)
        view.setUint32(2, source.length, true)
        return new InitFileTransferReplyD2HPacket(reply(86, 17, body))
      }
      if (packet instanceof ReadFileH2DPacket) {
        const view = new DataView(packet.data.buffer, packet.data.byteOffset)
        const address = view.getUint32(7, true)
        const size = view.getUint16(11, true)
        requests.push(size)
        const body = new Uint8Array(4 + size)
        new DataView(body.buffer).setUint32(0, address, true)
        body.set(source.subarray(address, address + size), 4)
        return new ReadFileReplyD2HPacket(reply(86, 20, body))
      }
      if (packet instanceof ExitFileTransferH2DPacket) {
        return new ExitFileTransferReplyD2HPacket(
          reply(86, 18, new Uint8Array())
        )
      }
      throw new Error("unexpected transfer packet")
    }
  }
  const connection = new TransferConnection({} as never)
  expect(
    await connection.downloadFileToHost({
      filename: "test.bin",
      vendor: 1,
      loadAddress: 0,
    })
  ).toEqual(source)
  expect(requests).toEqual([496, 4])
})

test("oversized downloads exit file-transfer mode before rejecting", async () => {
  class TransferConnection extends V5SerialConnection {
    override get isConnected(): boolean {
      return true
    }

    exits = 0

    override async writeDataAsync(
      packet: Parameters<V5SerialConnection["writeDataAsync"]>[0]
    ): Promise<Awaited<ReturnType<V5SerialConnection["writeDataAsync"]>>> {
      if (packet instanceof InitFileTransferH2DPacket) {
        const body = new Uint8Array(10)
        const view = new DataView(body.buffer)
        view.setUint16(0, 1024, true)
        view.setUint32(2, 1024, true)
        return new InitFileTransferReplyD2HPacket(reply(86, 17, body))
      }

      if (packet instanceof ExitFileTransferH2DPacket) {
        this.exits++

        return new ExitFileTransferReplyD2HPacket(
          reply(86, 18, new Uint8Array())
        )
      }

      throw new Error("unexpected transfer packet")
    }
  }

  const connection = new TransferConnection({} as never, {
    maxFileDownloadBytes: 128,
  })

  await expect(
    connection.downloadFileToHost({
      filename: "large.bin",
      vendor: 1,
    })
  ).rejects.toThrow("download limit")

  expect(connection.exits).toBe(1)
})

test("terminal decodes output and writes stdin", async () => {
  class FakeConnection extends V5SerialConnection {
    connected = true

    reads: Array<Uint8Array | undefined> = [
      Uint8Array.from([0xc3]),
      Uint8Array.from([0xa9]),
      new Uint8Array(),
    ]

    writes: Uint8Array[] = []

    override get isConnected(): boolean {
      return this.connected
    }

    override async readUserFifo(): Promise<Uint8Array | undefined> {
      return this.reads.shift() ?? new Uint8Array()
    }

    override async writeUserFifo(data: Uint8Array | string): Promise<number> {
      const bytes =
        typeof data === "string" ? new TextEncoder().encode(data) : data

      this.writes.push(bytes.slice())
      return bytes.byteLength
    }
  }

  const connection = new FakeConnection({} as never)

  const terminal = new V5UserProgramTerminal(connection, {
    idlePollIntervalMs: 0,
  })

  const text: string[] = []
  terminal.on("text", (value) => text.push(value as string))
  terminal.start()
  await Bun.sleep(5)

  expect(text.join("")).toBe("é")
  expect(await terminal.write("in")).toBe(2)
  expect(connection.writes[0]).toEqual(new TextEncoder().encode("in"))
  await terminal.close()
})

test("device terminals stay open until closed or disposed", async () => {
  class FakeConnection extends V5SerialConnection {
    override get isConnected(): boolean {
      return true
    }

    override async query1() {
      return {} as NonNullable<
        Awaited<ReturnType<V5SerialConnection["query1"]>>
      >
    }

    override async readUserFifo() {
      return new TextEncoder().encode("log\n")
    }

    override async close() {}
  }

  class FakeDevice extends V5SerialDevice {
    override async refresh() {
      return true
    }
  }

  const device = new FakeDevice({} as never, { autoRefresh: false })
  await device.connect(new FakeConnection({} as never))
  const terminal = device.openTerminal()
  expect(terminal).toBeDefined()
  expect(terminal!.isRunning).toBe(true)
  const output: string[] = []
  terminal!.on("text", (text) => {
    output.push(text)
    void terminal!.close()
  })
  await Bun.sleep(5)
  expect(output.join("")).toBe("log\n")
  expect(terminal!.isRunning).toBe(false)

  const second = device.openTerminal()
  expect(second!.isRunning).toBe(true)
  await device.dispose()
  expect(second!.isRunning).toBe(false)
})

test("USB file-read replies without an ACK decode their address and preserve NACKs", () => {
  const payload = new Uint8Array(8)
  new DataView(payload.buffer).setUint32(0, 0x03800000, true)
  payload.set([0xcc, 0x99, 0, 0], 4)
  // Actual USB replies place the address immediately after command 0x14.
  const packet = new Uint8Array(4 + 1 + payload.length + 2)
  packet.set([0xaa, 0x55, 86, 1 + payload.length + 2, 20], 0)
  packet.set(payload, 5)
  const crc = PacketEncoder.getInstance().crcgen.crc16(
    packet.subarray(0, -2),
    0
  )
  packet[packet.length - 2] = crc >>> 8
  packet[packet.length - 1] = crc & 0xff
  expect(ReadFileReplyD2HPacket.isValidPacket(packet, 4)).toBe(true)
  const decoded = new ReadFileReplyD2HPacket(packet)
  expect(decoded.addr).toBe(0x03800000)
  expect(new Uint8Array(decoded.buf)).toEqual(payload.subarray(4))
  expect(decoded.length).toBe(4)
  // VEXos also returns an ACK-less signed error address with no data.
  const errorPacket = packet.slice(0, 11)
  errorPacket[3] = 7
  errorPacket.set([0xd6, 0xff, 0xff, 0xff], 5)
  expect(ReadFileReplyD2HPacket.isValidPacket(errorPacket, 4)).toBe(false)
  expect(
    ReadFileReplyD2HPacket.isValidPacket(
      reply(86, 20, new Uint8Array(), AckType.CDC2_NACK),
      4
    )
  ).toBe(false)
})
