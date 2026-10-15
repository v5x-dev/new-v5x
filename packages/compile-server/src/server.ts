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
import { BinaryArtifactSender } from "./artifact-transfer"
import {
  LanguageSessionManager,
  languageProtocol,
  type LanguageSocketData,
} from "./language"
import { NativeCompiler } from "./native-build"

export interface CompileServerOptions {
  hostname: string
  port: number
  token: string
  origins: Array<string>
  assetsUrl: string
  cacheDirectory: string
  nativeToolchainDirectory?: string
  nativeCommandTimeoutMs?: number
  clangdPath?: string
  bubblewrapPath?: string
  tls?: { cert: string; key: string }
  worker?: () => Worker
}

type Connection = LanguageSocketData
type ActiveBuild = {
  socket: ServerWebSocket<Connection>
  controller: AbortController
  backend: "native" | "wasm"
  artifactEncoding: "legacy" | "binary-v1"
  sender?: BinaryArtifactSender
}
type WorkerMessage =
  | { type: "output"; text: string }
  | { type: "error"; message: string }
  | { type: "result"; result: BrowserBuildResult }

export function createCompileServer(options: CompileServerOptions) {
  if (options.token.length < 16)
    throw new Error("Server token must contain at least 16 characters")
  const nativeCompiler = options.nativeToolchainDirectory
    ? new NativeCompiler({
        assetsUrl: options.assetsUrl,
        cacheDirectory: options.cacheDirectory,
        toolchainDirectory: options.nativeToolchainDirectory,
        commandTimeoutMs: options.nativeCommandTimeoutMs,
      })
    : undefined
  let worker: Worker | undefined
  let active: ActiveBuild | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let connections = 0
  let languageConnections = 0
  const language = new LanguageSessionManager({
    assetsUrl: options.assetsUrl,
    cacheDirectory: options.cacheDirectory,
    clangdPath: options.clangdPath,
    bubblewrapPath: options.bubblewrapPath,
  })
  const cancelBuild = (build = active) => {
    if (!build) return
    if (active === build) active = undefined
    clearTimeout(timer)
    timer = undefined
    build.controller.abort()
    if (build.backend === "wasm") {
      worker?.terminate()
      worker = undefined
    }
  }
  const fail = (build: ActiveBuild, message: string) => {
    if (active !== build) return
    try {
      build.socket.send(JSON.stringify({ type: "error", message }))
    } catch {
      // The client may have disconnected before the failure was reported.
    }
    cancelBuild(build)
  }
  const sendResult = async (build: ActiveBuild, result: BrowserBuildResult) => {
    if (active !== build) return
    try {
      const artifactBytes = result.artifacts.reduce(
        (sum, artifact) => sum + artifact.bytes.byteLength,
        0
      )
      if (artifactBytes > maximumArtifactBytes)
        throw new Error("Build artifacts exceed 64 MB")
      if (build.artifactEncoding === "legacy") {
        build.socket.send(
          JSON.stringify({
            type: "result",
            result: {
              ...result,
              artifacts: result.artifacts.map(({ path, bytes }) => ({
                path,
                base64: Buffer.from(bytes).toString("base64"),
              })),
            },
          })
        )
        clearTimeout(timer)
        timer = undefined
        active = undefined
        return
      }
      const sender = new BinaryArtifactSender(
        build.socket,
        result,
        build.controller.signal
      )
      build.sender = sender
      build.socket.send(
        JSON.stringify({
          type: "result-start",
          result: {
            commitSha: result.commitSha,
            exitCode: result.exitCode,
            output: result.output,
          },
          artifacts: result.artifacts.map(({ path, bytes }) => ({
            path,
            byteLength: bytes.byteLength,
          })),
        })
      )
      await sender.start()
      if (active !== build) return
      clearTimeout(timer)
      timer = undefined
      active = undefined
      build.socket.send(JSON.stringify({ type: "result-end" }))
    } catch (error) {
      fail(build, error instanceof Error ? error.message : String(error))
    }
  }
  const report = (build: ActiveBuild, text: string) => {
    if (active !== build) return
    try {
      build.socket.send(JSON.stringify({ type: "output", text }))
    } catch {
      cancelBuild(build)
    }
  }
  const startWasm = (build: ActiveBuild, input: BrowserBuildInput) => {
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
      }
      worker.onerror = () =>
        fail(build, "Compilation worker crashed. Retry the build.")
      worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
        if (active !== build) return
        if (data.type === "result") void sendResult(build, data.result)
        else if (data.type === "output") report(build, data.text)
        else fail(build, data.message)
      }
      worker.postMessage({
        input,
        assetsUrl: options.assetsUrl,
        cacheDirectory: options.cacheDirectory,
      })
    } catch (error) {
      fail(build, error instanceof Error ? error.message : String(error))
    }
  }
  const start = (
    socket: ServerWebSocket<Connection>,
    input: BrowserBuildInput,
    artifactEncoding: ActiveBuild["artifactEncoding"]
  ) => {
    const build: ActiveBuild = {
      socket,
      controller: new AbortController(),
      backend: nativeCompiler ? "native" : "wasm",
      artifactEncoding,
    }
    active = build
    timer = setTimeout(
      () => fail(build, "Remote build exceeded ten minutes"),
      10 * 60_000
    )
    if (nativeCompiler) {
      void nativeCompiler
        .build(input, (text) => report(build, text), build.controller.signal)
        .then((result) => sendResult(build, result))
        .catch((error) => {
          if (active === build)
            fail(build, error instanceof Error ? error.message : String(error))
        })
    } else startWasm(build, input)
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
      if (url.pathname !== "/compile" && url.pathname !== "/language")
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
      const isLanguage = url.pathname === "/language"
      const protocol = isLanguage ? languageProtocol : compilationProtocol
      if (request.headers.get("sec-websocket-protocol") !== protocol)
        return new Response("Unsupported WebSocket protocol", { status: 400 })
      if (isLanguage ? languageConnections >= 4 : connections >= 8)
        return new Response("Too many connections", { status: 503 })
      if (
        server.upgrade(request, {
          data: {
            authenticated: true,
            kind: isLanguage ? "language" : "compile",
          },
          headers: { "Sec-WebSocket-Protocol": protocol },
        })
      ) {
        if (isLanguage) languageConnections++
        return
      }
      return new Response("Expected a WebSocket connection", { status: 400 })
    },
    websocket: {
      maxPayloadLength: 8 * 1024 * 1024,
      idleTimeout: 0,
      open(socket) {
        if (socket.data.kind === "language") {
          socket.send(
            JSON.stringify({ type: "ready", protocol: languageProtocol })
          )
        } else {
          connections++
          socket.send(
            JSON.stringify({ type: "ready", protocol: compilationProtocol })
          )
        }
      },
      message(socket, data) {
        if (socket.data.kind === "language") {
          language.receive(socket, data)
          return
        }
        if (active?.socket === socket && active.sender) {
          if (typeof data !== "string") {
            fail(active, "Invalid artifact acknowledgement")
            return
          }
          try {
            active.sender.ack(JSON.parse(data))
          } catch (error) {
            fail(active, error instanceof Error ? error.message : String(error))
          }
          return
        }
        try {
          if (typeof data !== "string")
            throw new Error("Expected a JSON build request")
          const message = JSON.parse(data)
          if (!message || typeof message !== "object" || Array.isArray(message))
            throw new Error("Invalid build request")
          if (
            message.artifactEncoding !== undefined &&
            message.artifactEncoding !== "binary-v1"
          )
            throw new Error("Unsupported artifact encoding")
          if (message.type !== "build") throw new Error("Unknown request")
          const input = validateRemoteInput(message.input)
          if (active)
            throw new Error(
              "Compilation server is busy. Retry when the current build finishes."
            )
          start(
            socket,
            input,
            message.artifactEncoding === "binary-v1" ? "binary-v1" : "legacy"
          )
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
        if (socket.data.kind === "language") {
          languageConnections--
          language.disconnect(socket)
        } else {
          connections--
          if (active?.socket === socket) cancelBuild()
        }
      },
    },
  })
  return {
    server,
    async stop() {
      cancelBuild()
      worker?.terminate()
      worker = undefined
      const languageDisposal = language.stopAll()
      server.stop(true)
      await Promise.all([languageDisposal, nativeCompiler?.dispose()])
    },
  }
}
