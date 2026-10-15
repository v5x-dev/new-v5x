import { readFile, rm, unlink } from "node:fs/promises"
import { join } from "node:path"
import type { ServerWebSocket } from "bun"
import { maximumCommands } from "./language/commands"
import {
  LspFrameParser,
  maximumMessageBytes,
  send,
  writeFrame,
} from "./language/lsp-frames"
import {
  byteLengthOfFiles,
  isRecord,
  isVirtualPath,
  mapPhysicalUriToVirtual,
  mapVirtualUriToPhysical,
  physicalPath,
  remapUris,
  validProjectPath,
  virtualProjectPathFromUri,
  writeVirtualFile,
} from "./language/paths"
import { launchLanguageSession } from "./language/launch"

export { rewriteCompileCommand, validateCommands } from "./language/commands"

export const languageProtocol = "v5x-language-v1"

const maximumPendingRequests = 128
const maximumPendingBytes = 8 * 1024 * 1024

export interface LanguageSocketData {
  authenticated: true
  kind: "compile" | "language"
}

interface LanguageSession {
  socket: ServerWebSocket<LanguageSocketData>
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
  root?: string
  child?: ReturnType<typeof Bun.spawn>
  reader?: ReadableStreamDefaultReader<Uint8Array>
}

export interface LanguageServerOptions {
  assetsUrl: string
  cacheDirectory: string
  clangdPath?: string
  bubblewrapPath?: string
}

export class LanguageSessionManager {
  private sessions = new Map<
    ServerWebSocket<LanguageSocketData>,
    LanguageSession
  >()

  constructor(private options: LanguageServerOptions) {}

  receive(socket: ServerWebSocket<LanguageSocketData>, data: unknown) {
    if (
      typeof data !== "string" ||
      Buffer.byteLength(data) > maximumMessageBytes
    ) {
      this.fail(socket, "Invalid language server message")
      return
    }

    let message: unknown
    try {
      message = JSON.parse(data)
    } catch {
      this.fail(socket, "Invalid language server message")
      return
    }

    if (!isRecord(message) || typeof message.kind !== "string") {
      this.fail(socket, "Invalid language server message")
      return
    }

    if (message.kind === "start") {
      if (this.sessions.has(socket)) {
        this.fail(socket, "Language session has already started")
        return
      }

      let cancelQueued!: () => void
      const queueCancellation = new Promise<void>((resolve) => {
        cancelQueued = resolve
      })
      const session: LanguageSession = {
        socket,
        files: new Map(),
        closed: false,
        stopping: false,
        started: false,
        abort: new AbortController(),
        queue: Promise.resolve(),
        queueCancellation,
        cancelQueued,
        pendingRequests: 0,
        pendingBytes: 0,
      }
      this.sessions.set(socket, session)
      void this.start(session, message)
        .catch((error) => {
          if (session.closed) return
          this.fail(
            socket,
            error instanceof Error ? error.message : "Language service failed"
          )
        })
        .finally(async () => {
          if (session.closed && session.root)
            await rm(session.root, { recursive: true, force: true }).catch(
              () => {}
            )
        })
      return
    }

    if (message.kind === "stop") {
      this.stop(socket)
      return
    }

    const session = this.sessions.get(socket)
    if (!session || session.closed || session.stopping) {
      this.fail(socket, "Language session is closed")
      return
    }
    if (!session.child || !session.root) {
      this.fail(socket, "Language session has not started")
      return
    }

    const messageBytes = Buffer.byteLength(data)
    if (
      session.pendingRequests + 1 > maximumPendingRequests ||
      session.pendingBytes + messageBytes > maximumPendingBytes
    ) {
      this.failSession(session, "Language request queue limit exceeded")
      return
    }

    session.pendingRequests++
    session.pendingBytes += messageBytes
    session.queue = Promise.race([session.queue, session.queueCancellation])
      .then(async () => {
        try {
          if (session.closed) throw new Error("Language session is closed")
          await this.handleRequest(session, message)
        } finally {
          session.pendingRequests--
          session.pendingBytes -= messageBytes
        }
      })
      .catch((error) => {
        if (session.closed) return
        this.failSession(
          session,
          error instanceof Error ? error.message : "Invalid language request"
        )
      })
  }

  disconnect(socket: ServerWebSocket<LanguageSocketData>) {
    const session = this.sessions.get(socket)
    if (!session) return
    this.sessions.delete(socket)
    void this.dispose(session)
  }

  async stopAll() {
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(sessions.map((session) => this.dispose(session)))
  }

  private async start(session: LanguageSession, message: Record<string, any>) {
    await launchLanguageSession(
      this.options,
      session,
      message,
      (current) => this.readOutput(current as LanguageSession),
      (socket, status) => this.fail(socket, status)
    )
  }

  private async writeRpc(session: LanguageSession, message: unknown) {
    if (!isRecord(message) || message.jsonrpc !== "2.0")
      throw new Error("Invalid LSP message")
    const encoded = JSON.stringify(
      remapUris(message, (uri) => mapVirtualUriToPhysical(uri, "/"))
    )
    if (Buffer.byteLength(encoded) > maximumMessageBytes)
      throw new Error("LSP message exceeds the 8 MB language limit")
    await writeFrame(session.child!, encoded)
  }

  private async updateFiles(session: LanguageSession, value: unknown) {
    if (!isRecord(value) || Object.keys(value).length > maximumCommands)
      throw new Error("Invalid workspace file update")

    const changes: Array<[string, string | null]> = []
    for (const [path, contents] of Object.entries(value)) {
      if (!validProjectPath(path)) throw new Error("Invalid source file path")
      if (contents !== null && typeof contents !== "string")
        throw new Error("Invalid source file contents")
      changes.push([path, contents])
    }

    const next = new Map(session.files)
    for (const [path, contents] of changes) {
      if (path === "compile_commands.json")
        throw new Error(
          "The compilation database is managed by the language service"
        )
      if (contents === null) next.delete(path)
      else next.set(path, contents)
    }
    this.checkSourceLimits(next)

    for (const [path, contents] of changes) {
      const absolute = join(session.root!, "workspace", ...path.split("/"))
      if (contents === null) {
        await unlink(absolute).catch(() => {})
      } else {
        await writeVirtualFile(session.root!, `/workspace/${path}`, contents)
      }
    }
    session.files = next
  }

  private async updateDocument(
    session: LanguageSession,
    value: Record<string, any>
  ) {
    if (!isRecord(value.message) || !isRecord(value.message.params))
      throw new Error("Invalid LSP document update")
    const { method, params } = value.message
    const document = params.textDocument
    if (!isRecord(document) || typeof document.uri !== "string")
      throw new Error("Invalid LSP document URI")
    const path = virtualProjectPathFromUri(document.uri)
    if (path !== value.path || !validProjectPath(path))
      throw new Error("Document path does not match its LSP URI")
    if (path === "compile_commands.json")
      throw new Error(
        "The compilation database is managed by the language service"
      )

    let contents: unknown
    if (method === "textDocument/didOpen") contents = document.text
    else if (method === "textDocument/didChange")
      contents = Array.isArray(params.contentChanges)
        ? params.contentChanges[0]?.text
        : undefined
    else throw new Error("Unsupported document update")
    if (typeof contents !== "string")
      throw new Error("Invalid LSP document contents")

    const next = new Map(session.files)
    next.set(path, contents)
    this.checkSourceLimits(next)
    session.files = next
    await writeVirtualFile(session.root!, `/workspace/${path}`, contents)
    await this.writeRpc(session, value.message)
  }

  private async handleRequest(
    session: LanguageSession,
    message: Record<string, any>
  ) {
    if (session.closed) return
    if (!session.child || !session.root)
      throw new Error("Language session has not started")
    if (message.kind === "rpc") await this.writeRpc(session, message.message)
    else if (message.kind === "files")
      await this.updateFiles(session, message.files)
    else if (message.kind === "document")
      await this.updateDocument(session, message)
    else if (message.kind === "read") await this.readFile(session, message)
    else throw new Error("Unknown language server request")
  }

  private async readFile(session: LanguageSession, value: Record<string, any>) {
    try {
      if (
        !Number.isSafeInteger(value.id) ||
        typeof value.path !== "string" ||
        !isVirtualPath(value.path)
      )
        throw new Error("Invalid header path")
      const filename = physicalPath(session.root!, value.path)
      const bytes = new Uint8Array(await readFile(filename))
      if (bytes.byteLength > 2 * 1024 * 1024)
        throw new Error("Header exceeds the 2 MB read limit")
      const contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      send(session.socket, { kind: "read", id: value.id, contents })
    } catch {
      send(session.socket, {
        kind: "read",
        id: value.id,
        error: { message: "Header is not available in the language SDK" },
      })
    }
  }

  private async readOutput(session: LanguageSession) {
    const parser = new LspFrameParser()
    try {
      while (!session.closed) {
        const { done, value } = await session.reader!.read()
        if (done) return
        for (const message of parser.push(value)) {
          const response = remapUris(message, (uri) =>
            mapPhysicalUriToVirtual(uri, "/")
          )
          send(session.socket, { kind: "rpc", message: response })
        }
      }
    } catch (error) {
      if (!session.closed)
        this.fail(
          session.socket,
          error instanceof Error
            ? error.message
            : "Could not read clangd output"
        )
    }
  }

  private checkSourceLimits(files: Map<string, string>) {
    if (files.size > maximumCommands)
      throw new Error("Too many workspace files")
    const bytes = byteLengthOfFiles(files)
    if (bytes > 6 * 1024 * 1024)
      throw new Error("Project exceeds the 6 MB language source limit")
  }

  private fail(socket: ServerWebSocket<LanguageSocketData>, message: string) {
    try {
      send(socket, { kind: "error", message })
      socket.close(1011, message.slice(0, 120))
    } catch {
      socket.close(1011, "Language service failed")
    }
  }

  private failSession(session: LanguageSession, message: string) {
    if (session.closed) return
    if (this.sessions.get(session.socket) === session)
      this.sessions.delete(session.socket)
    void this.dispose(session)
    this.fail(session.socket, message)
  }

  private stop(socket: ServerWebSocket<LanguageSocketData>) {
    const session = this.sessions.get(socket)
    if (!session) {
      socket.close(1000, "Stopped")
      return
    }
    session.stopping = true
    this.sessions.delete(socket)
    void this.dispose(session)
    socket.close(1000, "Stopped")
  }

  private async dispose(session: LanguageSession) {
    if (session.closed) return
    session.closed = true
    session.cancelQueued()
    session.abort.abort()
    try {
      await session.reader?.cancel()
    } catch {
      // The process may already have closed stdout.
    }
    if (session.child) {
      try {
        session.child.kill("SIGTERM")
      } catch {
        // The process may already have exited.
      }
      await Promise.race([
        session.child.exited,
        new Promise((resolve) => setTimeout(resolve, 500)),
      ])
      if (session.child.exitCode === null) {
        try {
          session.child.kill("SIGKILL")
        } catch {
          // The process may already have exited.
        }
      }
    }
    if (session.root)
      await rm(session.root, { recursive: true, force: true }).catch(() => {})
  }
}
