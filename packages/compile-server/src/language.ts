import { constants } from "node:fs"
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { ServerWebSocket } from "bun"
import { compileCommands as createCompileCommands } from "@v5x/compiler/compile-commands"
import type { BuildBundleFile } from "@v5x/compiler/build-archive"
import type { BuildSdkManifest } from "@v5x/compiler/build-assets"
import type { CompileCommand } from "@v5x/compiler"
import { validateRemoteInput } from "@v5x/compiler/remote-build"
import { assetLoader } from "./assets"

export const languageProtocol = "v5x-language-v1"

const maximumMessageBytes = 8 * 1024 * 1024
const maximumCommandBytes = 2 * 1024 * 1024
const maximumCommands = 2000
const maximumArgumentsPerCommand = 256
const maximumPendingRequests = 128
const maximumPendingBytes = 8 * 1024 * 1024
const roots = ["workspace", "sdk", "toolchain"] as const
type RootName = (typeof roots)[number]

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
    send(session.socket, { kind: "status", status: "Preparing isolated SDK" })

    const validated = validateRemoteInput({
      template: message.template,
      commitSha: "language-service",
      workspaceId: message.workspaceId,
      files: message.files,
    })
    const bubblewrapPath =
      this.options.bubblewrapPath ??
      process.env.V5X_BWRAP_PATH ??
      "/usr/bin/bwrap"
    try {
      await access(bubblewrapPath, constants.X_OK)
    } catch {
      throw new Error(
        `Native language service requires executable bubblewrap at ${bubblewrapPath}. Install bubblewrap or set V5X_BWRAP_PATH; clangd will not run without the filesystem sandbox.`
      )
    }
    const configuredClangdPath =
      this.options.clangdPath ??
      process.env.V5X_CLANGD_PATH ??
      "/usr/bin/clangd"
    let clangdPath: string
    try {
      clangdPath = await realpath(configuredClangdPath)
    } catch {
      throw new Error(
        `Native language service requires clangd at ${configuredClangdPath}. Install clangd 15 or newer or set V5X_CLANGD_PATH.`
      )
    }
    const pathUnderUsr = relative("/usr", clangdPath)
    if (
      pathUnderUsr === ".." ||
      pathUnderUsr.startsWith(`..${sep}`) ||
      isAbsolute(pathUnderUsr)
    )
      throw new Error("clangd must be installed under /usr for the sandbox")
    validateCommands(message.commands)
    session.files = new Map(
      Object.entries(validated.files).filter(
        ([path]) => path !== "compile_commands.json"
      )
    )

    session.root = await mkdtemp(join(tmpdir(), "v5x-language-"))
    await mkdir(join(session.root, "home"), { recursive: true, mode: 0o700 })
    await mkdir(join(session.root, "tmp"), { recursive: true, mode: 0o700 })
    for (const root of roots)
      await mkdir(join(session.root, root), { recursive: true, mode: 0o700 })

    const loader = assetLoader(
      this.options.assetsUrl,
      this.options.cacheDirectory
    )
    const sdk = await loader.manifest<BuildSdkManifest>(
      "/language/sdk-manifest.json"
    )
    if (!/^\d+(?:\.\d+){1,3}$/.test(sdk.gccVersion))
      throw new Error("Invalid language SDK compiler version")
    const bundles = sdk.templates[validated.template]
    if (!bundles) throw new Error(`Missing ${validated.template} language SDK`)

    const sdkFiles: Array<BuildBundleFile> = []
    for (const name of bundles) {
      const asset = sdk.bundles[name]
      if (!asset) throw new Error(`Missing ${name} language SDK`)
      sdkFiles.push(...(await loader.bundle(asset, false)))
    }
    if (session.closed) return

    for (const [path, contents] of sdkFiles) {
      if (!isSdkVirtualPath(path)) throw new Error("Invalid SDK file path")
      await writeVirtualFile(session.root, path, contents)
    }

    for (const [path, contents] of session.files) {
      if (path === "compile_commands.json") continue
      await writeVirtualFile(session.root, `/workspace/${path}`, contents)
    }

    const trustedCommands = createCompileCommands(
      Object.fromEntries(session.files),
      validated.template,
      sdk.gccVersion
    )
    const physicalCommands = trustedCommands.map((command) =>
      rewriteCompileCommand(command, "/")
    )
    const compilationDatabase = JSON.stringify(physicalCommands)
    if (Buffer.byteLength(compilationDatabase) > maximumCommandBytes)
      throw new Error("Compilation database exceeds the 2 MB language limit")
    await writeVirtualFile(
      session.root,
      "/workspace/compile_commands.json",
      compilationDatabase
    )

    if (session.closed) return
    send(session.socket, {
      kind: "status",
      status: "Starting sandboxed native clangd",
    })

    let child: ReturnType<typeof Bun.spawn>
    try {
      child = Bun.spawn(
        [
          bubblewrapPath,
          "--unshare-all",
          "--unshare-pid",
          "--unshare-net",
          "--new-session",
          "--die-with-parent",
          "--clearenv",
          "--setenv",
          "HOME",
          "/home/clangd",
          "--setenv",
          "TMPDIR",
          "/tmp",
          "--setenv",
          "XDG_CACHE_HOME",
          "/home/clangd/.cache",
          "--setenv",
          "PATH",
          "/usr/bin",
          "--setenv",
          "LANG",
          "C.UTF-8",
          "--setenv",
          "LC_ALL",
          "C",
          "--dir",
          "/usr",
          "--ro-bind",
          "/usr",
          "/usr",
          "--dir",
          "/lib",
          "--ro-bind",
          "/lib",
          "/lib",
          "--dir",
          "/lib64",
          "--ro-bind",
          "/lib64",
          "/lib64",
          "--dev",
          "/dev",
          "--proc",
          "/proc",
          "--dir",
          "/home",
          "--dir",
          "/home/clangd",
          "--bind",
          join(session.root, "home"),
          "/home/clangd",
          "--dir",
          "/tmp",
          "--bind",
          join(session.root, "tmp"),
          "/tmp",
          "--dir",
          "/workspace",
          "--bind",
          join(session.root, "workspace"),
          "/workspace",
          "--dir",
          "/sdk",
          "--ro-bind",
          join(session.root, "sdk"),
          "/sdk",
          "--dir",
          "/toolchain",
          "--ro-bind",
          join(session.root, "toolchain"),
          "/toolchain",
          "--chdir",
          "/workspace",
          "--",
          clangdPath,
          "--compile-commands-dir=/workspace",
          "--background-index",
          "-j=1",
          "--pch-storage=disk",
          "--limit-results=20",
          "--log=error",
          "--clang-tidy",
          "--enable-config=0",
        ],
        {
          cwd: "/",
          env: {},
          stdin: "pipe",
          stdout: "pipe",
          stderr: "ignore",
        }
      )
    } catch {
      throw new Error(
        "Could not start sandboxed clangd. Install bubblewrap at /usr/bin/bwrap (or set V5X_BWRAP_PATH) and clangd 15 or newer (or set V5X_CLANGD_PATH)."
      )
    }
    session.child = child
    if (!child.stdout || typeof child.stdout === "number")
      throw new Error("Native clangd stdout pipe is unavailable")
    session.reader = child.stdout.getReader()
    void this.readOutput(session)
    void child.exited.then((code) => {
      if (session.closed || session.stopping || !session.started) return
      this.fail(session.socket, `clangd exited unexpectedly (${code})`)
    })

    if (session.closed) {
      child.kill()
      return
    }
    await Bun.sleep(100)
    if (session.closed) return
    if (child.exitCode !== null)
      throw new Error(
        "Bubblewrap could not create the clangd sandbox. Check that Linux user, PID, and network namespaces are enabled."
      )
    session.started = true
    send(session.socket, { kind: "started" })
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

export function validateCommands(value: unknown): Array<CompileCommand> {
  if (!Array.isArray(value) || value.length > maximumCommands)
    throw new Error("Invalid compilation database")
  let totalBytes = 0
  const commands = value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.directory !== "string" ||
      typeof entry.file !== "string" ||
      !Array.isArray(entry.arguments) ||
      !entry.arguments.length ||
      entry.arguments.length > maximumArgumentsPerCommand ||
      entry.arguments.some(
        (argument: unknown) =>
          typeof argument !== "string" ||
          argument.length > 8192 ||
          argument.includes("\0")
      )
    )
      throw new Error("Invalid compilation database entry")

    totalBytes +=
      Buffer.byteLength(entry.directory) +
      Buffer.byteLength(entry.file) +
      entry.arguments.reduce(
        (size: number, argument: string) => size + Buffer.byteLength(argument),
        0
      )
    if (totalBytes > maximumCommandBytes)
      throw new Error("Compilation database exceeds the 2 MB language limit")

    return {
      directory: validateWorkspaceAbsolute(entry.directory),
      file: validateWorkspaceAbsolute(entry.file),
      arguments: validateArguments(entry.arguments),
    }
  })
  return commands
}

export function rewriteCompileCommand(
  command: CompileCommand,
  root: string
): CompileCommand {
  const directory = physicalPath(root, command.directory)
  const file = physicalPath(root, command.file)
  const arguments_ = command.arguments.map((argument) =>
    rewriteArgumentPaths(argument, root)
  )
  arguments_[0] = "clang"
  return { directory, file, arguments: arguments_ }
}

function validateArguments(arguments_: Array<string>) {
  const blocked = [
    /^@/,
    /^-fplugin(?:=|$)/,
    /^-fplugin-arg-/,
    /^-plugin(?:=|$)/,
    /^--?load(?:=|$)/,
    /^-specs(?:=|$)/,
    /^-wrapper(?:=|$)/,
    /^-ivfsoverlay(?:=|$)/,
    /^-include-pch(?:=|$)/,
    /^-fmodule-file(?:=|$)/,
    /^--config(?:-|=|$)/,
    /^--gcc-toolchain(?:=|$)/,
    /^-gcc-toolchain(?:=|$)/,
  ]
  if (
    arguments_.some((argument) =>
      blocked.some((pattern) => pattern.test(argument))
    )
  )
    throw new Error(
      "Compilation database contains an unsupported compiler option"
    )

  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]
    if (
      argument === "-Xclang" &&
      ["-load", "-plugin", "-ivfsoverlay", "-fplugin"].includes(
        arguments_[index + 1] ?? ""
      )
    )
      throw new Error(
        "Compilation database contains an unsupported compiler option"
      )
    if (argument === "-B")
      throw new Error(
        "Compiler search paths are not allowed in the language service"
      )

    const pathValue = pathOptionValue(argument, arguments_[index + 1])
    if (pathValue) validateCompilePath(pathValue.value)
    if (pathValue?.consumesNext) index++
  }
  return arguments_
}

const separatedPathOptions = new Set([
  "-I",
  "-F",
  "-isystem",
  "-iquote",
  "-idirafter",
  "-isystem-after",
  "-iframework",
  "-iframeworkwithsysroot",
  "-stdlib++-isystem",
  "-include",
  "-imacros",
  "-resource-dir",
  "--sysroot",
  "-isysroot",
  "-fmodule-map-file",
  "-fprofile-instr-use",
  "-fprofile-sample-use",
  "-fprofile-remapping-file",
  "-fcoverage-compilation-dir",
  "-fprebuilt-module-path",
  "-fmodules-user-build-path",
  "-fmodules-cache-path",
  "-working-directory",
  "-o",
])

function pathOptionValue(argument: string, next: string | undefined) {
  if (separatedPathOptions.has(argument)) {
    if (!next) throw new Error("Compiler path option has no value")
    return { value: next, consumesNext: true }
  }
  for (const option of separatedPathOptions) {
    if (argument.startsWith(option + "=") && option !== "-o")
      return { value: argument.slice(option.length + 1), consumesNext: false }
    if (
      [
        "-I",
        "-F",
        "-isystem",
        "-iquote",
        "-idirafter",
        "-isystem-after",
        "-iframeworkwithsysroot",
        "-iframework",
        "-stdlib++-isystem",
        "-include",
        "-imacros",
      ].some(
        (prefix) =>
          argument.startsWith(prefix) && argument.length > prefix.length
      )
    ) {
      const prefix = [
        "-isystem-after",
        "-iframeworkwithsysroot",
        "-stdlib++-isystem",
        "-isystem",
        "-idirafter",
        "-iquote",
        "-include",
        "-imacros",
        "-iframework",
        "-I",
        "-F",
      ].find((item) => argument.startsWith(item))!
      return { value: argument.slice(prefix.length), consumesNext: false }
    }
  }
  return undefined
}

function validateCompilePath(value: string) {
  if (!value || value.includes("\0") || value.includes("\\"))
    throw new Error("Invalid compiler path")
  if (isAbsolute(value)) {
    validateVirtualAbsolute(value)
    return
  }
  if (value.split("/").some((part) => part === ".." || part === "."))
    throw new Error("Compiler paths must stay inside the project workspace")
}

function rewriteArgumentPaths(argument: string, root: string) {
  if (argument.includes("\0") || argument.includes("\\"))
    throw new Error("Invalid compiler argument")
  for (const virtualRoot of roots) {
    const path = `/${virtualRoot}`
    if (argument === path || argument.startsWith(path + "/"))
      return join(root, argument.slice(1))
    for (const option of [
      "-isystem",
      "-idirafter",
      "-iquote",
      "-include",
      "-imacros",
      "-I",
    ])
      if (argument.startsWith(option + path))
        return option + join(root, argument.slice(option.length + 1))
  }
  for (const virtualRoot of roots) {
    const pattern = new RegExp(`(^|[=,:])/${virtualRoot}(?=/|$)`, "g")
    argument = argument.replace(pattern, (_match, prefix: string) => {
      const virtual = `/${virtualRoot}`
      return prefix + join(root, virtual.slice(1))
    })
  }
  return argument
}

function validateWorkspaceAbsolute(value: string) {
  const root = "/workspace"
  if (
    !(value === root || value.startsWith(root + "/")) ||
    !isVirtualRootOrPath(value)
  )
    throw new Error("Compilation paths must be inside /workspace")
  return value
}

function validateVirtualAbsolute(value: string) {
  if (!isVirtualPath(value))
    throw new Error(
      "Compiler paths must stay inside /workspace, /sdk, or /toolchain"
    )
}

function isVirtualPath(value: string): value is `/${RootName}/${string}` {
  return (
    roots.some((root) => value.startsWith(`/${root}/`)) &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !value
      .slice(1)
      .split("/")
      .some((part) => !part || part === "." || part === "..")
  )
}

function isVirtualRootOrPath(value: string) {
  return roots.some((root) => value === `/${root}`) || isVirtualPath(value)
}

function isSdkVirtualPath(value: string) {
  return (
    (/^\/(sdk|toolchain)\//.test(value) ||
      /^\/workspace\/include\//.test(value)) &&
    isVirtualPath(value)
  )
}

function validProjectPath(value: string) {
  return (
    !!value &&
    value.length <= 4096 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.split("/").some((part) => !part || part === "." || part === "..")
  )
}

function physicalPath(root: string, virtualPath: string) {
  if (!isVirtualRootOrPath(virtualPath))
    throw new Error("Invalid virtual filesystem path")
  const physical = resolve(root, virtualPath.slice(1))
  const relativePath = relative(root, physical)
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  )
    throw new Error("Path escaped the language session")
  return physical
}

async function writeVirtualFile(
  root: string,
  virtualPath: string,
  contents: string | Uint8Array
) {
  const filename = physicalPath(root, virtualPath)
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 })
  await writeFile(filename, contents, { mode: 0o600 })
}

function byteLengthOfFiles(files: Map<string, string>) {
  let total = 0
  for (const [path, contents] of files)
    total += Buffer.byteLength(path) + Buffer.byteLength(contents)
  return total
}

function virtualProjectPathFromUri(uri: string) {
  const url = new URL(uri)
  if (url.protocol !== "file:" || url.host || url.search || url.hash)
    throw new Error("Invalid workspace URI")
  const path = decodeURIComponent(url.pathname)
  if (!path.startsWith("/workspace/"))
    throw new Error("Document URI must be inside /workspace")
  return path.slice("/workspace/".length)
}

function mapVirtualUriToPhysical(uri: string, root: string) {
  const url = new URL(uri)
  if (url.protocol !== "file:") return uri
  if (url.host || url.search || url.hash)
    throw new Error("LSP file URI must be a local mounted path")
  const virtualPath = decodeURIComponent(url.pathname)
  if (
    virtualPath === "/workspace" ||
    virtualPath === "/sdk" ||
    virtualPath === "/toolchain"
  )
    return pathToFileURL(join(root, virtualPath.slice(1))).href
  if (!isVirtualPath(virtualPath))
    throw new Error("LSP file URI is outside the mounted workspace and SDK")
  return pathToFileURL(physicalPath(root, virtualPath)).href
}

function mapPhysicalUriToVirtual(uri: string, root: string) {
  const url = new URL(uri)
  if (url.protocol !== "file:") return uri
  if (url.host || url.search || url.hash) return undefined
  let physical: string
  try {
    physical = fileURLToPath(url)
  } catch {
    return undefined
  }
  const rel = relative(root, physical)
  if (
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    !isVirtualRootOrPath(`/${rel.split(sep).join("/")}`)
  )
    return undefined
  return pathToFileURL(`/` + rel.split(sep).join("/")).href
}

function remapUris<T>(
  value: T,
  mapUri: (uri: string) => string | undefined
): T | undefined {
  if (typeof value === "string")
    return (value.startsWith("file:") ? mapUri(value) : value) as T | undefined
  if (Array.isArray(value))
    return value
      .map((item) => remapUris(item, mapUri))
      .filter((item) => item !== undefined) as T
  if (!isRecord(value)) return value
  const mapped: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const mappedKey = key.startsWith("file:") ? mapUri(key) : key
    if (mappedKey === undefined) continue
    const mappedItem = remapUris(item, mapUri)
    if (mappedItem === undefined) {
      if (key === "result") mapped[mappedKey] = null
      if (["uri", "targetUri", "oldUri", "newUri"].includes(key))
        return undefined
      continue
    }
    mapped[mappedKey] = mappedItem
  }
  return mapped as T
}

async function writeFrame(child: ReturnType<typeof Bun.spawn>, json: string) {
  const body = Buffer.from(json)
  const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`)
  const stdin = child.stdin
  if (!stdin || typeof stdin === "number")
    throw new Error("Native clangd stdin pipe is unavailable")
  stdin.write(Buffer.concat([header, body]))
  await stdin.flush()
}

class LspFrameParser {
  private buffer = new Uint8Array()

  push(chunk: Uint8Array) {
    if (this.buffer.byteLength + chunk.byteLength > maximumMessageBytes + 8192)
      throw new Error("Clangd response exceeded the 8 MB language limit")
    const joined = new Uint8Array(this.buffer.byteLength + chunk.byteLength)
    joined.set(this.buffer)
    joined.set(chunk, this.buffer.byteLength)
    this.buffer = joined

    const messages: Array<unknown> = []
    while (true) {
      const headerEnd = findHeaderEnd(this.buffer)
      if (headerEnd < 0) {
        if (this.buffer.byteLength > 8192)
          throw new Error("Invalid clangd message header")
        break
      }
      const header = new TextDecoder().decode(
        this.buffer.subarray(0, headerEnd)
      )
      const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header)
      const length = match ? Number(match[1]) : NaN
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > maximumMessageBytes
      )
        throw new Error("Invalid clangd message length")
      const bodyStart = headerEnd + 4
      if (this.buffer.byteLength - bodyStart < length) break
      const body = this.buffer.subarray(bodyStart, bodyStart + length)
      try {
        messages.push(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))
        )
      } catch {
        throw new Error("Clangd response could not be read")
      }
      this.buffer = this.buffer.slice(bodyStart + length)
    }
    return messages
  }
}

function findHeaderEnd(bytes: Uint8Array) {
  for (let index = 3; index < bytes.length; index++)
    if (
      bytes[index - 3] === 13 &&
      bytes[index - 2] === 10 &&
      bytes[index - 1] === 13 &&
      bytes[index] === 10
    )
      return index - 3
  return -1
}

function send(socket: ServerWebSocket<LanguageSocketData>, message: unknown) {
  const text = JSON.stringify(message)
  if (Buffer.byteLength(text) > maximumMessageBytes)
    throw new Error("Language server response exceeded the 8 MB limit")
  if (socket.getBufferedAmount() > maximumMessageBytes)
    throw new Error("Language server client is not keeping up")
  socket.send(text)
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
