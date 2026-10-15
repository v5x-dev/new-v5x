import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import { compileCommands } from "@v5x/compiler/compile-commands"
import type { ProjectTemplate } from "@v5x/compiler"
import type { BuildSdkManifest } from "@v5x/compiler/build-assets"
import { createCompileServer } from "./server"
import {
  LanguageSessionManager,
  rewriteCompileCommand,
  validateCommands,
} from "./language"

const token = "language-test-token-0123456789"
const languageProtocol = "v5x-language-v1"
const languageDirectory = fileURLToPath(
  new URL("../../../apps/code/public/language/", import.meta.url)
)
// Native clangd tests need the same sandbox and clangd the server launches.
const nativeClangd = test.skipIf(
  !existsSync(process.env.V5X_BWRAP_PATH ?? "/usr/bin/bwrap") ||
    !existsSync(process.env.V5X_CLANGD_PATH ?? "/usr/bin/clangd")
)
let assetServer: ReturnType<typeof Bun.serve> | undefined
let languageServer: ReturnType<typeof createCompileServer> | undefined
let cacheDirectory: string | undefined
let privateDirectory: string | undefined

afterEach(async () => {
  await languageServer?.stop()
  languageServer = undefined
  assetServer?.stop(true)
  assetServer = undefined
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true })
  cacheDirectory = undefined
  if (privateDirectory)
    await rm(privateDirectory, { recursive: true, force: true })
  privateDirectory = undefined
})

function validCommand(
  arguments_: Array<string> = ["clang", "-c", "/workspace/main.cpp"]
) {
  return {
    directory: "/workspace",
    file: "/workspace/main.cpp",
    arguments: arguments_,
  }
}

async function startNativeTestServer() {
  const manifest = JSON.parse(
    await readFile(join(languageDirectory, "sdk-manifest.json"), "utf8")
  ) as BuildSdkManifest
  const allowedAssets = new Set(
    Object.values(manifest.bundles).map((asset) => basename(asset!.url))
  )
  assetServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/language/sdk-manifest.json")
        return new Response(JSON.stringify(manifest), {
          headers: { "Content-Type": "application/json" },
        })
      const name = basename(url.pathname)
      if (!url.pathname.startsWith("/language/") || !allowedAssets.has(name))
        return new Response("Not found", { status: 404 })
      return new Response(await readFile(join(languageDirectory, name)))
    },
  })

  cacheDirectory = await mkdtemp(join(tmpdir(), "v5x-language-assets-"))
  languageServer = createCompileServer({
    hostname: "127.0.0.1",
    port: 0,
    token,
    origins: ["https://code.v5x.dev"],
    assetsUrl: `http://127.0.0.1:${assetServer.port}`,
    cacheDirectory,
  })
  return manifest
}

async function connectLanguageSocket() {
  const socket = new WebSocket(
    `ws://127.0.0.1:${languageServer!.server.port}/language?token=${token}`,
    languageProtocol
  )
  const inbox = new SocketInbox(socket)
  await inbox.next((message) => message.type === "ready")
  return { socket, inbox }
}

async function startNativeSession(
  socket: WebSocket,
  inbox: SocketInbox,
  manifest: BuildSdkManifest,
  template: ProjectTemplate,
  files: Record<string, string>,
  workspaceId: string
) {
  socket.send(
    JSON.stringify({
      kind: "start",
      files,
      template,
      commands: compileCommands(files, template, manifest.gccVersion),
      workspaceId,
    })
  )
  const started = await inbox.next(
    (message) => message.kind === "started" || message.kind === "error"
  )
  expect(started.kind).toBe("started")
}

async function initializeLanguageSession(
  socket: WebSocket,
  inbox: SocketInbox
) {
  const initialized = await request(inbox, socket, 1, "initialize", {
    processId: null,
    rootUri: "file:///workspace",
    workspaceFolders: [{ uri: "file:///workspace", name: "Project" }],
    capabilities: {
      general: { positionEncodings: ["utf-16"] },
      workspace: { configuration: true, workspaceFolders: true },
      textDocument: {
        completion: { completionItem: { snippetSupport: true } },
        hover: { contentFormat: ["plaintext"] },
      },
    },
  })
  expect(initialized.result.capabilities.positionEncoding ?? "utf-16").toBe(
    "utf-16"
  )
  socket.send(
    JSON.stringify({
      kind: "rpc",
      message: { jsonrpc: "2.0", method: "initialized", params: {} },
    })
  )
}

function openDocument(
  socket: WebSocket,
  path: string,
  contents: string,
  languageId = "cpp"
) {
  socket.send(
    JSON.stringify({
      kind: "document",
      path,
      message: {
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri: `file:///workspace/${path}`,
            languageId,
            version: 1,
            text: contents,
          },
        },
      },
    })
  )
}

test("rejects compiler plugins, response files, overlays, and host include paths", () => {
  for (const arguments_ of [
    ["clang", "-fplugin=/tmp/plugin.so"],
    ["clang", "-fplugin", "/tmp/plugin.so"],
    ["clang", "-Xclang", "-load", "/tmp/plugin.so"],
    ["clang", "-Xclang", "-load=/tmp/plugin.so"],
    ["clang", "@/workspace/flags.rsp"],
    ["clang", "-ivfsoverlay", "/workspace/overlay.yaml"],
    ["clang", "-I/etc"],
    ["clang", "-F", "/etc"],
    ["clang", "-iframework", "/etc"],
    ["clang", "-resource-dir=/etc/clang"],
    ["clang", "-I../../etc"],
  ])
    expect(() => validateCommands([validCommand(arguments_)])).toThrow()

  expect(validateCommands([validCommand()])).toHaveLength(1)
})

test("the language endpoint checks token, origin, and WebSocket protocol", async () => {
  languageServer = createCompileServer({
    hostname: "127.0.0.1",
    port: 0,
    token,
    origins: ["https://code.v5x.dev"],
    assetsUrl: "https://code.v5x.dev",
    cacheDirectory: "/tmp/v5x-unused-language-auth-test",
  })
  const endpoint = `http://127.0.0.1:${languageServer.server.port}/language`

  expect((await fetch(`${endpoint}?token=invalid`)).status).toBe(401)
  expect(
    (
      await fetch(`${endpoint}?token=${token}`, {
        headers: { Origin: "https://untrusted.example" },
      })
    ).status
  ).toBe(403)
  expect(
    (
      await fetch(`${endpoint}?token=${token}`, {
        headers: { "Sec-WebSocket-Protocol": "v5x-compile-v1" },
      })
    ).status
  ).toBe(400)
})

test("does not launch clangd without the required bubblewrap sandbox", async () => {
  languageServer = createCompileServer({
    hostname: "127.0.0.1",
    port: 0,
    token,
    origins: ["https://code.v5x.dev"],
    assetsUrl: "https://code.v5x.dev",
    cacheDirectory: "/tmp/v5x-unused-language-sandbox-test",
    bubblewrapPath: "/missing/v5x-bwrap",
  })
  const { socket, inbox } = await connectLanguageSocket()
  socket.send(
    JSON.stringify({
      kind: "start",
      files: {},
      template: "vexcode",
      commands: [],
      workspaceId: "missing-sandbox-test",
    })
  )

  const error = await inbox.next((message) => message.kind === "error")
  expect(error.message).toContain("requires executable bubblewrap")
  expect(error.message).toContain(
    "clangd will not run without the filesystem sandbox"
  )
  await inbox.closed
})

test("rewrites compile commands to bubblewrap's mounted filesystem", () => {
  const rewritten = rewriteCompileCommand(
    {
      directory: "/workspace",
      file: "/workspace/src/main.cpp",
      arguments: [
        "clang++",
        "-I/sdk/vexv5/include",
        "-isystem",
        "/toolchain/include",
        "-c",
        "/workspace/src/main.cpp",
      ],
    },
    "/"
  )

  expect(rewritten.directory).toBe("/workspace")
  expect(rewritten.file).toBe("/workspace/src/main.cpp")
  expect(rewritten.arguments).toEqual([
    "clang",
    "-I/sdk/vexv5/include",
    "-isystem",
    "/toolchain/include",
    "-c",
    "/workspace/src/main.cpp",
  ])
})

type QueuedSession = {
  socket: unknown
  files: Map<string, string>
  closed: boolean
  stopping: boolean
  started: boolean
  abort: AbortController
  queue: Promise<void>
  queueCancellation: Promise<void>
  cancelQueued: () => void
  pendingRequests: number
  pendingBytes: number
  root: string
  child: {
    exited: Promise<number>
    exitCode: number | null
    kill: () => void
  }
}

async function createQueuedLanguageSession() {
  const manager = new LanguageSessionManager({
    assetsUrl: "http://127.0.0.1:1",
    cacheDirectory: "/tmp/v5x-unused-language-queue-test",
  })
  const root = await mkdtemp(join(tmpdir(), "v5x-language-queue-test-"))
  const sent: Array<string> = []
  const closes: Array<{ code: number; reason: string }> = []
  const socket = {
    send(message: string) {
      sent.push(message)
    },
    close(code: number, reason: string) {
      closes.push({ code, reason })
    },
    getBufferedAmount() {
      return 0
    },
  } as never

  let releaseQueue!: () => void
  const queue = new Promise<void>((resolve) => {
    releaseQueue = resolve
  })
  let cancelQueued!: () => void
  const queueCancellation = new Promise<void>((resolve) => {
    cancelQueued = resolve
  })
  const session: QueuedSession = {
    socket,
    files: new Map(),
    closed: false,
    stopping: false,
    started: true,
    abort: new AbortController(),
    queue,
    queueCancellation,
    cancelQueued,
    pendingRequests: 0,
    pendingBytes: 0,
    root,
    child: {
      exited: Promise.resolve(0),
      exitCode: null,
      kill() {},
    },
  }
  const internals = manager as unknown as {
    sessions: Map<unknown, QueuedSession>
    handleRequest: () => Promise<void>
  }
  internals.sessions.set(socket, session)
  let handledRequests = 0
  internals.handleRequest = async () => {
    handledRequests++
  }

  return {
    manager,
    socket,
    session,
    root,
    sent,
    closes,
    releaseQueue,
    handledRequests: () => handledRequests,
  }
}

test("bounds a language session's pending request count", async () => {
  const fixture = await createQueuedLanguageSession()
  try {
    for (let id = 0; id < 129; id++) {
      fixture.manager.receive(
        fixture.socket,
        JSON.stringify({
          kind: "rpc",
          message: { jsonrpc: "2.0", method: `pending/${id}` },
        })
      )
      if (fixture.session.closed) break
    }

    expect(fixture.session.closed).toBe(true)
    expect(fixture.session.pendingRequests).toBe(128)
    expect(fixture.closes).toEqual([
      { code: 1011, reason: "Language request queue limit exceeded" },
    ])
  } finally {
    fixture.releaseQueue()
    await fixture.session.queue
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test("bounds a language session's pending UTF-8 bytes", async () => {
  const fixture = await createQueuedLanguageSession()
  const paddedRequest = JSON.stringify({
    kind: "rpc",
    message: {
      jsonrpc: "2.0",
      method: "pending/bytes",
      params: { value: "x".repeat(4_300_000) },
    },
  })
  try {
    expect(Buffer.byteLength(paddedRequest)).toBeLessThan(8 * 1024 * 1024)
    fixture.manager.receive(fixture.socket, paddedRequest)
    fixture.manager.receive(fixture.socket, paddedRequest)

    expect(fixture.session.closed).toBe(true)
    expect(fixture.session.pendingRequests).toBe(1)
    expect(fixture.closes).toEqual([
      { code: 1011, reason: "Language request queue limit exceeded" },
    ])
  } finally {
    fixture.releaseQueue()
    await fixture.session.queue
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test("rejects queued language requests after session close", async () => {
  const fixture = await createQueuedLanguageSession()
  try {
    fixture.manager.receive(
      fixture.socket,
      JSON.stringify({
        kind: "rpc",
        message: { jsonrpc: "2.0", method: "pending/closed" },
      })
    )
    fixture.manager.disconnect(fixture.socket)
    await fixture.session.queue

    expect(fixture.handledRequests()).toBe(0)
    expect(fixture.session.pendingRequests).toBe(0)
    expect(fixture.session.pendingBytes).toBe(0)
  } finally {
    fixture.releaseQueue()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

nativeClangd(
  "native clangd loads all four real SDK templates",
  async () => {
    const manifest = await startNativeTestServer()
    const existing = new Set(
      (await readdir(tmpdir())).filter((name) =>
        name.startsWith("v5x-language-")
      )
    )

    for (const template of [
      "vexcode",
      "pros",
      "ez-template",
      "jar-template",
    ] as const) {
      const vexSdk = template === "vexcode" || template === "jar-template"
      const main = vexSdk
        ? "#include <vex_motor.h>\nint main() { vex::motor motor{1}; return 0; }\n"
        : "#include <main.h>\nint main() { return 0; }\n"
      const files = { "src/main.cpp": main }
      const { socket, inbox } = await connectLanguageSocket()

      await startNativeSession(
        socket,
        inbox,
        manifest,
        template,
        files,
        `real-sdk-${template}`
      )
      await initializeLanguageSession(socket, inbox)
      openDocument(socket, "src/main.cpp", main)

      if (vexSdk) {
        const definition = await request(
          inbox,
          socket,
          2,
          "textDocument/definition",
          {
            textDocument: { uri: "file:///workspace/src/main.cpp" },
            position: { line: 1, character: 22 },
          }
        )
        const locations: Array<any> = Array.isArray(definition.result)
          ? definition.result
          : [definition.result]
        expect(
          locations.some((location) =>
            location?.uri?.startsWith("file:///sdk/vexv5/include/vex_motor.h")
          )
        ).toBe(true)

        socket.send(
          JSON.stringify({
            kind: "read",
            id: 3,
            path: "/sdk/vexv5/include/vex_motor.h",
          })
        )
        const header = await inbox.next(
          (message) => message.kind === "read" && message.id === 3
        )
        expect(header.contents).toContain("class motor")
      } else {
        socket.send(
          JSON.stringify({
            kind: "read",
            id: 3,
            path: "/workspace/include/main.h",
          })
        )
        const header = await inbox.next(
          (message) => message.kind === "read" && message.id === 3
        )
        expect(header.contents).toContain("common definitions")
        expect(header.contents).toContain("PROS")
      }

      socket.send(
        JSON.stringify({
          kind: "document",
          path: "compile_commands.json",
          message: {
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
              textDocument: {
                uri: "file:///workspace/compile_commands.json",
                languageId: "json",
                version: 1,
                text: "[]",
              },
            },
          },
        })
      )
      const rejectedDatabaseWrite = await inbox.next(
        (message) => message.kind === "error"
      )
      expect(rejectedDatabaseWrite.message).toContain(
        "managed by the language service"
      )

      socket.close()
      await inbox.closed
      await waitForSessionCleanup(existing)
    }
    // Each template starts a cold clangd session, which is slow on CI runners.
  },
  60_000
)

nativeClangd(
  "clangd cannot read host files or another session's workspace",
  async () => {
    const manifest = await startNativeTestServer()
    privateDirectory = await mkdtemp(
      join(tmpdir(), "v5x-language-host-private-")
    )
    const hostSecretPath = join(privateDirectory, "host-secret.h")
    const hostSecretMarker = "V5X_HOST_PRIVATE_SENTINEL"
    await writeFile(
      hostSecretPath,
      `struct HostPrivateSentinel { int ${hostSecretMarker}; };\n`
    )

    const existing = new Set(
      (await readdir(tmpdir())).filter((name) =>
        name.startsWith("v5x-language-")
      )
    )
    const first = await connectLanguageSocket()
    await startNativeSession(
      first.socket,
      first.inbox,
      manifest,
      "vexcode",
      {
        "src/main.cpp": "int main() { return 0; }\n",
        "session-private.h":
          "struct OtherSessionPrivate { int privateValue; };\n",
      },
      "sandbox-session-one"
    )
    const rootNames = (await readdir(tmpdir())).filter(
      (name) => name.startsWith("v5x-language-") && !existing.has(name)
    )
    expect(rootNames).toHaveLength(1)
    const firstSessionHeader = join(
      tmpdir(),
      rootNames[0],
      "workspace/session-private.h"
    )

    const hostSource = `#include "${hostSecretPath}"\nHostPrivateSentinel hostSecret;\n`
    const otherSessionSource = `#include "${firstSessionHeader}"\nOtherSessionPrivate otherSecret;\n`
    const secondFiles = {
      "src/host.cpp": hostSource,
      "src/other-session.cpp": otherSessionSource,
    }
    const second = await connectLanguageSocket()
    await startNativeSession(
      second.socket,
      second.inbox,
      manifest,
      "vexcode",
      secondFiles,
      "sandbox-session-two"
    )
    await initializeLanguageSession(second.socket, second.inbox)
    openDocument(second.socket, "src/host.cpp", hostSource)
    openDocument(second.socket, "src/other-session.cpp", otherSessionSource)

    const hostDiagnostics = await second.inbox.next(
      (message) =>
        message.kind === "rpc" &&
        message.message?.method === "textDocument/publishDiagnostics" &&
        message.message.params?.uri === "file:///workspace/src/host.cpp"
    )
    const hostMessages = hostDiagnostics.message.params.diagnostics
      .map((diagnostic: { message: string }) => diagnostic.message)
      .join("\n")
    expect(hostMessages).toMatch(/file not found|no such file|unknown type/i)
    expect(hostMessages).not.toContain(hostSecretMarker)

    const otherSessionDiagnostics = await second.inbox.next(
      (message) =>
        message.kind === "rpc" &&
        message.message?.method === "textDocument/publishDiagnostics" &&
        message.message.params?.uri ===
          "file:///workspace/src/other-session.cpp"
    )
    const otherSessionMessages =
      otherSessionDiagnostics.message.params.diagnostics
        .map((diagnostic: { message: string }) => diagnostic.message)
        .join("\n")
    expect(otherSessionMessages).toMatch(
      /file not found|no such file|unknown type/i
    )

    second.socket.close()
    first.socket.close()
    await Promise.all([second.inbox.closed, first.inbox.closed])
    await waitForSessionCleanup(existing)
  }
)

async function request(
  inbox: SocketInbox,
  socket: WebSocket,
  id: number,
  method: string,
  params: unknown
) {
  socket.send(
    JSON.stringify({
      kind: "rpc",
      message: { jsonrpc: "2.0", id, method, params },
    })
  )
  return inbox
    .next((message) => message.kind === "rpc" && message.message?.id === id)
    .then((message) => message.message)
}

async function waitForSessionCleanup(existing: Set<string>) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const active = (await readdir(tmpdir())).filter(
      (name) => name.startsWith("v5x-language-") && !existing.has(name)
    )
    if (!active.length) return
    await Bun.sleep(25)
  }
  throw new Error("Language session directory was not removed after disconnect")
}

class SocketInbox {
  messages: Array<any> = []
  closed: Promise<void>
  private waiters: Array<{
    predicate: (message: any) => boolean
    resolve: (message: any) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []

  constructor(socket: WebSocket) {
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data as string)
      const index = this.waiters.findIndex((waiter) =>
        waiter.predicate(message)
      )
      if (index < 0) this.messages.push(message)
      else {
        const [waiter] = this.waiters.splice(index, 1)
        clearTimeout(waiter.timer)
        waiter.resolve(message)
      }
    }
    this.closed = new Promise((resolve) => {
      socket.onclose = () => resolve()
    })
    socket.onerror = () => {
      for (const waiter of this.waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error("Language WebSocket failed"))
      }
      this.waiters = []
    }
  }

  next(predicate: (message: any) => boolean, timeout = 20_000) {
    const index = this.messages.findIndex(predicate)
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0])
    return new Promise<any>((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter)
          reject(new Error("Timed out waiting for language server response"))
        }, timeout),
      }
      this.waiters.push(waiter)
    })
  }
}
