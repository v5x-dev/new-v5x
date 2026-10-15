import { afterEach, expect, test } from "bun:test"
import {
  buildOnServer,
  compilationProtocol,
  testCompilationServer,
  validateRemoteInput,
} from "@v5x/compiler/remote-build"
import { createCompileServer } from "./server"
import type { CompileServerOptions } from "./server"
import type { BrowserBuildInput } from "@v5x/compiler/browser-build"

class CompilerWorker {
  onmessage?: (event: { data: unknown }) => void
  onerror?: () => void
  terminated = false
  stalled = false
  postMessage({ input }: { input: BrowserBuildInput }) {
    if (this.stalled) return
    queueMicrotask(() => {
      this.onmessage?.({ data: { type: "output", text: "compiled\n" } })
      this.onmessage?.({
        data: {
          type: "result",
          result: {
            commitSha: input.commitSha,
            exitCode: 0,
            output: "compiled\n",
            artifacts: [
              {
                path: "build/workspace.bin",
                bytes: new Uint8Array([0, 128, 255]),
              },
            ],
          },
        },
      })
    })
  }
  terminate() {
    this.terminated = true
  }
}

const token = "0123456789abcdef0123456789abcdef"
let running: ReturnType<typeof createCompileServer> | undefined
function setup(
  worker = new CompilerWorker(),
  overrides: Partial<CompileServerOptions> = {}
) {
  running = createCompileServer({
    hostname: "127.0.0.1",
    port: 0,
    token,
    origins: ["https://code.v5x.dev"],
    assetsUrl: "https://code.v5x.dev",
    cacheDirectory: "/tmp/v5x-unused-test-cache",
    worker: () => worker as unknown as Worker,
    ...overrides,
  })
  return `ws://127.0.0.1:${running.server.port}/compile?token=${token}`
}
const input: BrowserBuildInput = {
  template: "vexcode",
  commitSha: "abc",
  files: { "src/main.cpp": "int main() {}" },
}
afterEach(async () => {
  await running?.stop()
  running = undefined
})

test("negotiates binary-v1, streams output, and returns exact artifacts over WebSocket", async () => {
  const endpoint = setup()
  await testCompilationServer(endpoint)
  const output: Array<string> = []
  const result = await buildOnServer(endpoint, input, (text) =>
    output.push(text)
  )
  expect(output).toEqual(["compiled\n"])
  expect(result.commitSha).toBe("abc")
  expect(result.artifacts[0].bytes).toEqual(new Uint8Array([0, 128, 255]))
  expect((await buildOnServer(endpoint, input, () => {})).exitCode).toBe(0)
})

test("keeps the base64 result format for clients that omit artifactEncoding", async () => {
  const endpoint = setup()
  const socket = new WebSocket(endpoint, compilationProtocol)
  try {
    const result = await new Promise<{
      artifacts: Array<{ path: string; base64: string }>
      commitSha: string
      exitCode: number
      output: string
    }>((resolve, reject) => {
      socket.onerror = () => reject(new Error("WebSocket error"))
      socket.onmessage = ({ data }) => {
        if (typeof data !== "string") {
          reject(new Error("Legacy client received a binary frame"))
          return
        }
        const message = JSON.parse(data)
        if (message.type === "ready") {
          socket.send(JSON.stringify({ type: "build", input }))
        } else if (message.type === "result") resolve(message.result)
        else if (message.type === "error") reject(new Error(message.message))
      }
    })

    expect(result).toEqual({
      commitSha: "abc",
      exitCode: 0,
      output: "compiled\n",
      artifacts: [{ path: "build/workspace.bin", base64: "AID/" }],
    })
  } finally {
    socket.close()
  }
})

test("rejects unsupported artifact encodings before compilation", async () => {
  const worker = new CompilerWorker()
  const endpoint = setup(worker)
  const socket = new WebSocket(endpoint, compilationProtocol)
  try {
    const message = await new Promise<{ message: string }>(
      (resolve, reject) => {
        socket.onerror = () => reject(new Error("WebSocket error"))
        socket.onmessage = ({ data }) => {
          if (typeof data !== "string") {
            reject(new Error("Unexpected binary response"))
            return
          }
          const response = JSON.parse(data)
          if (response.type === "ready")
            socket.send(
              JSON.stringify({
                type: "build",
                input,
                artifactEncoding: "binary-v2",
              })
            )
          else if (response.type === "error") resolve(response)
        }
      }
    )

    expect(message.message).toBe("Unsupported artifact encoding")
    expect(worker.terminated).toBe(false)
  } finally {
    socket.close()
  }
})

test("an explicit native toolchain selects native compilation", async () => {
  const worker = new CompilerWorker()
  const endpoint = setup(worker, {
    nativeToolchainDirectory: "/missing-v5x-native-toolchain",
  })
  let message = ""
  try {
    await buildOnServer(endpoint, input, () => {})
  } catch (error) {
    message = (error as Error).message
  }
  expect(message).toContain("Native ARM toolchain not found")
  expect(worker.terminated).toBe(false)
})

test("rejects wrong tokens and unapproved browser origins", async () => {
  const endpoint = setup()
  const http = endpoint.replace("ws:", "http:")
  expect((await fetch(http.replace(token, "wrong"))).status).toBe(401)
  expect(
    (await fetch(http, { headers: { Origin: "https://untrusted.example" } }))
      .status
  ).toBe(403)
})

test("rejects traversal, oversize projects, and unsupported templates before compilation", () => {
  expect(() =>
    validateRemoteInput({ ...input, files: { "../escape.cpp": "" } })
  ).toThrow("Invalid source file")
  expect(() =>
    validateRemoteInput({
      ...input,
      files: { "src/main.cpp": "x".repeat(6 * 1024 * 1024) },
    })
  ).toThrow("6 MB")
  expect(() => validateRemoteInput({ ...input, template: "other" })).toThrow(
    "Invalid build"
  )
  expect(
    validateRemoteInput({
      ...input,
      experiments: { parallel: 2 },
      kind: "preload",
    })
  ).toEqual(input)
})

test("rejects a second build while busy and terminates compilation on cancellation", async () => {
  const worker = new CompilerWorker()
  worker.stalled = true
  const endpoint = setup(worker)
  const controller = new AbortController()
  const pending = buildOnServer(
    endpoint,
    input,
    () => {},
    controller.signal
  ).catch((error) => error)
  await Bun.sleep(30)
  let error: Error | undefined
  try {
    await buildOnServer(endpoint, input, () => {})
  } catch (reason) {
    error = reason as Error
  }
  expect(error?.message).toContain("busy")
  controller.abort()
  expect((await pending).message).toBe("Build cancelled")
  await Bun.sleep(30)
  expect(worker.terminated).toBe(true)
})

test("an already cancelled build does not open a connection", async () => {
  const endpoint = setup()
  const signal = AbortSignal.abort()
  let error: Error | undefined
  try {
    await buildOnServer(endpoint, input, () => {}, signal)
  } catch (reason) {
    error = reason as Error
  }
  expect(error?.message).toBe("Build cancelled")
})

test("rejects a result belonging to a different commit", async () => {
  class StaleWorker extends CompilerWorker {
    override postMessage({ input }: { input: BrowserBuildInput }) {
      super.postMessage({ input: { ...input, commitSha: "other-commit" } })
    }
  }
  const endpoint = setup(new StaleWorker())
  let message = ""
  try {
    await buildOnServer(endpoint, input, () => {})
  } catch (error) {
    message = (error as Error).message
  }
  expect(message).toContain("Invalid remote build result")
})

test("a server disconnect fails the pending build instead of returning partial artifacts", async () => {
  const worker = new CompilerWorker()
  worker.stalled = true
  const endpoint = setup(worker)
  const result = buildOnServer(endpoint, input, () => {}).catch(
    (error) => error
  )
  await Bun.sleep(20)
  await running!.stop()
  running = undefined
  expect((await result).message).toContain("disconnected")
})
