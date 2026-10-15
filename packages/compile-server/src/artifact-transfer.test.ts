import { expect, test } from "bun:test"
import type { BrowserBuildResult } from "@v5x/compiler/browser-build"
import {
  artifactChunkBytes,
  artifactWindowBytes,
  BinaryArtifactSender,
} from "./artifact-transfer"

interface SenderSocketData {
  sender?: BinaryArtifactSender
}

function startSenderServer(result: BrowserBuildResult, signal?: AbortSignal) {
  return Bun.serve<SenderSocketData>({
    fetch(request, server) {
      if (server.upgrade(request, { data: {} })) return
      return new Response("Expected WebSocket", { status: 400 })
    },
    websocket: {
      open(socket) {
        const sender = new BinaryArtifactSender(socket, result, signal)
        socket.data.sender = sender
        void sender.start().then(
          () => socket.send(JSON.stringify({ type: "done" })),
          (error: Error) =>
            socket.send(
              JSON.stringify({ type: "error", message: error.message })
            )
        )
      },
      message(socket, data) {
        if (typeof data !== "string") return
        const message = JSON.parse(data)
        if (!socket.data.sender?.ack(message))
          socket.send(JSON.stringify({ type: "error", message: "Invalid ACK" }))
      },
    },
  })
}

function sampleResult(bytes: Uint8Array): BrowserBuildResult {
  return {
    commitSha: "test-commit",
    exitCode: 0,
    output: "",
    artifacts: [{ path: "bin/robot", bytes }],
  }
}

test("streams binary chunks under a one MiB ACK window", async () => {
  const source = new Uint8Array(artifactChunkBytes * 5 + 101)
  for (let index = 0; index < source.length; index++)
    source[index] = (index * 17 + 3) & 0xff

  const server = startSenderServer(sampleResult(source))
  const received = new Uint8Array(source.length)
  const offsets = new Map<number, number>()
  let outstandingBytes = 0
  let peakOutstandingBytes = 0
  let receivedBytes = 0
  const pendingAcks: Array<{ index: number; offset: number; bytes: number }> =
    []

  try {
    await new Promise<void>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${server.port}`)
      client.binaryType = "arraybuffer"
      client.onerror = () => reject(new Error("WebSocket error"))
      client.onmessage = ({ data }) => {
        if (data instanceof ArrayBuffer) {
          if (data.byteLength <= 8) {
            reject(new Error("Short artifact frame"))
            return
          }
          const view = new DataView(data)
          const index = view.getUint32(0, true)
          const offset = view.getUint32(4, true)
          const chunkLength = data.byteLength - 8
          const expectedOffset = offsets.get(index) ?? 0
          if (index !== 0 || offset !== expectedOffset) {
            reject(new Error("Sender produced an out-of-order frame"))
            return
          }

          received.set(new Uint8Array(data, 8), offset)
          offsets.set(index, offset + chunkLength)
          receivedBytes += chunkLength
          outstandingBytes += data.byteLength
          peakOutstandingBytes = Math.max(
            peakOutstandingBytes,
            outstandingBytes
          )
          pendingAcks.push({
            index,
            offset: offset + chunkLength,
            bytes: data.byteLength,
          })

          if (
            outstandingBytes >= artifactChunkBytes * 3 ||
            receivedBytes === source.length
          ) {
            for (const ack of pendingAcks.splice(0)) {
              outstandingBytes -= ack.bytes
              client.send(
                JSON.stringify({
                  type: "artifact-ack",
                  index: ack.index,
                  offset: ack.offset,
                })
              )
            }
          }
          return
        }

        if (typeof data !== "string") {
          reject(new Error("Unexpected sender message"))
          return
        }
        const message = JSON.parse(data)
        if (message.type === "done") resolve()
        else reject(new Error(message.message ?? "Sender failed"))
      }
    })

    expect(peakOutstandingBytes).toBeGreaterThan(artifactChunkBytes * 2)
    expect(peakOutstandingBytes).toBeLessThanOrEqual(artifactWindowBytes)
    expect(receivedBytes).toBe(source.length)
    expect(received).toEqual(source)
  } finally {
    server.stop(true)
  }
})

test("rejects a transfer when its signal is aborted", async () => {
  const controller = new AbortController()
  const bytes = new Uint8Array(artifactChunkBytes)
  const server = startSenderServer(sampleResult(bytes), controller.signal)

  try {
    await new Promise<void>((resolve, reject) => {
      const client = new WebSocket(`ws://127.0.0.1:${server.port}`)
      client.binaryType = "arraybuffer"
      client.onerror = () => reject(new Error("WebSocket error"))
      client.onmessage = ({ data }) => {
        if (data instanceof ArrayBuffer) {
          controller.abort()
          return
        }
        if (typeof data !== "string")
          return reject(new Error("Unexpected message"))
        const message = JSON.parse(data)
        if (message.type === "error" && message.message === "Build cancelled")
          resolve()
        else reject(new Error(message.message ?? "Sender did not cancel"))
      }
    })
  } finally {
    server.stop(true)
  }
})
