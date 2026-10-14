import { timingSafeEqual } from "node:crypto"
import {
  compilationProtocol,
  maximumArtifactBytes,
  validateRemoteInput,
} from "@v5x/compiler/remote-build"
import type {
  BrowserBuildInput,
  BrowserBuildResult,
} from "@v5x/compiler/browser-build"
import type { ServerWebSocket } from "bun"

export interface CompileServerOptions {
  hostname: string
  port: number
  token: string
  origins: Array<string>
  assetsUrl: string
  cacheDirectory: string
  tls?: { cert: string; key: string }
  worker?: () => Worker
}

type Connection = { authenticated: true }
type WorkerMessage =
  | { type: "output"; text: string }
  | { type: "error"; message: string }
  | { type: "result"; result: BrowserBuildResult }

export function createCompileServer(options: CompileServerOptions) {
  if (options.token.length < 16)
    throw new Error("Server token must contain at least 16 characters")
  let worker: Worker | undefined
  let active: ServerWebSocket<Connection> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let connections = 0
  const reset = () => {
    clearTimeout(timer)
    timer = undefined
    worker?.terminate()
    worker = undefined
    active = undefined
  }
  const fail = (message: string) => {
    active?.send(JSON.stringify({ type: "error", message }))
    reset()
  }
  const start = (
    socket: ServerWebSocket<Connection>,
    input: BrowserBuildInput
  ) => {
    active = socket
    try {
      if (!worker) {
        worker =
          options.worker?.() ??
          new Worker(
            new URL(
              import.meta.url.endsWith(".ts")
                ? "./compiler.worker.ts"
                : "./compiler.worker.js",
              import.meta.url
            ).href
          )
        worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
          if (!active) return
          if (data.type === "result") {
            if (
              data.result.artifacts.reduce(
                (sum, artifact) => sum + artifact.bytes.length,
                0
              ) > maximumArtifactBytes
            ) {
              fail("Build artifacts exceed 64 MB")
              return
            }
            active.send(
              JSON.stringify({
                type: "result",
                result: {
                  ...data.result,
                  artifacts: data.result.artifacts.map(({ path, bytes }) => ({
                    path,
                    base64: Buffer.from(bytes).toString("base64"),
                  })),
                },
              })
            )
          } else active.send(JSON.stringify(data))
          if (data.type !== "output") {
            clearTimeout(timer)
            timer = undefined
            active = undefined
          }
        }
        worker.onerror = () =>
          fail("Compilation worker crashed. Retry the build.")
      }
      timer = setTimeout(
        () => fail("Remote build exceeded ten minutes"),
        10 * 60_000
      )
      worker.postMessage({
        input,
        assetsUrl: options.assetsUrl,
        cacheDirectory: options.cacheDirectory,
      })
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
  }
  const server = Bun.serve<Connection>({
    hostname: options.hostname,
    port: options.port,
    tls: options.tls,
    maxRequestBodySize: 8 * 1024 * 1024,
    fetch(request, server) {
      const url = new URL(request.url)
      if (url.pathname === "/health")
        return Response.json({ protocol: compilationProtocol })
      if (url.pathname !== "/compile")
        return new Response("Not found", { status: 404 })
      const origin = request.headers.get("origin")
      if (origin && !options.origins.includes(origin))
        return new Response("Origin not allowed", { status: 403 })
      const token = url.searchParams.get("token") ?? ""
      const expected = Buffer.from(options.token)
      const actual = Buffer.from(token)
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return new Response("Invalid server token", { status: 401 })
      if (request.headers.get("sec-websocket-protocol") !== compilationProtocol)
        return new Response("Unsupported compilation protocol", { status: 400 })
      if (connections >= 8)
        return new Response("Too many connections", { status: 503 })
      if (
        server.upgrade(request, {
          data: { authenticated: true },
          headers: { "Sec-WebSocket-Protocol": compilationProtocol },
        })
      )
        return
      return new Response("Expected a WebSocket connection", { status: 400 })
    },
    websocket: {
      maxPayloadLength: 8 * 1024 * 1024,
      idleTimeout: 0,
      open(socket) {
        connections++
        socket.send(
          JSON.stringify({ type: "ready", protocol: compilationProtocol })
        )
      },
      message(socket, data) {
        try {
          if (typeof data !== "string")
            throw new Error("Expected a JSON build request")
          const message = JSON.parse(data)
          if (message.type !== "build") throw new Error("Unknown request")
          const input = validateRemoteInput(message.input)
          if (active)
            throw new Error(
              "Compilation server is busy. Retry when the current build finishes."
            )
          start(socket, input)
        } catch (error) {
          socket.send(
            JSON.stringify({
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            })
          )
        }
      },
      close(socket) {
        connections--
        if (active === socket) reset()
      },
    },
  })
  return {
    server,
    stop() {
      reset()
      server.stop(true)
    },
  }
}
