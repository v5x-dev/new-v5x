import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import type { BuildCache } from "@v5x/compiler/build-cache"
import type { Session, SessionOptions } from "microbit-clang-wasm"

export const nativeToolchainVersion = "21.1.1"
export const nativeToolchainId = "Arm Toolchain ID: E0058 (1bbd3573)"
export const maxCommandTimeoutMs = 120_000
const maxCommandOutputBytes = 512 * 1024
const nativeResourcePath = "/toolchain/.native-clang-resource"
const nativeToolchainPath = "/opt/v5x-toolchain"
const nativeSandboxEnvironment = [
  "--clearenv",
  "--setenv",
  "HOME",
  "/tmp",
  "--setenv",
  "TMPDIR",
  "/tmp",
  "--setenv",
  "PATH",
  `${nativeToolchainPath}/bin:/usr/bin`,
  "--setenv",
  "LANG",
  "C.UTF-8",
]

type NativeRoots = {
  directory: string
  workspace: string
  sdk: string
  toolchain: string
  resource: string
}

export function abortError() {
  const error = new Error("Build cancelled")
  error.name = "AbortError"
  return error
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError()
}

export function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  throwIfAborted(signal)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort)
      reject(abortError())
    }
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      }
    )
  })
}

function validateVirtualPath(path: string) {
  return (
    path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path
      .split("/")
      .some(
        (part, index) => index > 0 && (!part || part === "." || part === "..")
      )
  )
}

function inside(parent: string, child: string) {
  const path = relative(parent, child)
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`))
}

export function createBuildCache(): BuildCache {
  const entries = new Map<string, Uint8Array>()
  let bytes = 0
  return {
    get: async (key) => entries.get(key),
    put: async (key, value) => {
      bytes -= entries.get(key)?.byteLength ?? 0
      entries.delete(key)
      const owned = value.slice()
      entries.set(key, owned)
      bytes += owned.byteLength
      while (bytes > 64 * 1024 * 1024) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        bytes -= entries.get(oldest)!.byteLength
        entries.delete(oldest)
      }
    },
  }
}

export class NativeFilesystem implements Session {
  readonly roots: NativeRoots
  private processes = new Set<ReturnType<typeof Bun.spawn>>()
  private disposed = false
  private signal?: AbortSignal
  private timeoutMs: number
  private readonly resourceSource: string
  private readonly toolchainDirectory: string

  private constructor(
    roots: NativeRoots,
    toolchainDirectory: string,
    resourceSource: string,
    timeoutMs: number
  ) {
    this.roots = roots
    this.toolchainDirectory = toolchainDirectory
    this.resourceSource = resourceSource
    this.timeoutMs = timeoutMs
  }

  static async create(
    toolchainDirectory: string,
    timeoutMs: number
  ): Promise<NativeFilesystem> {
    const directory = await mkdtemp(join(tmpdir(), "v5x-native-build-"))
    const roots: NativeRoots = {
      directory,
      workspace: join(directory, "workspace"),
      sdk: join(directory, "sdk"),
      toolchain: join(directory, "toolchain"),
      resource: join(directory, "toolchain", ".native-clang-resource"),
    }
    try {
      await Promise.all([
        mkdir(roots.workspace, { recursive: true }),
        mkdir(roots.sdk, { recursive: true }),
        mkdir(roots.toolchain, { recursive: true }),
        mkdir(roots.resource, { recursive: true }),
      ])
      return new NativeFilesystem(
        roots,
        toolchainDirectory,
        join(toolchainDirectory, "lib", "clang", "21"),
        timeoutMs
      )
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  setSignal(signal: AbortSignal) {
    this.signal = signal
  }

  private hostPath(path: string, writing = false) {
    if (!validateVirtualPath(path))
      throw new Error(`Invalid native path: ${path}`)
    const resourcePrefix = `${nativeResourcePath}/`
    if (path.startsWith(resourcePrefix)) {
      if (writing) throw new Error("Native Clang resources are read only")
      const suffix = path.slice(resourcePrefix.length)
      const hostPath = resolve(this.resourceSource, suffix)
      if (!inside(this.resourceSource, hostPath))
        throw new Error(`Invalid native resource path: ${path}`)
      return hostPath
    }

    if (
      path === nativeToolchainPath ||
      path.startsWith(`${nativeToolchainPath}/`)
    ) {
      if (writing) throw new Error("Native ARM toolchain is read only")
      const suffix =
        path === nativeToolchainPath
          ? ""
          : path.slice(nativeToolchainPath.length + 1)
      const hostPath = resolve(this.toolchainDirectory, suffix)
      if (!inside(this.toolchainDirectory, hostPath))
        throw new Error(`Invalid native toolchain path: ${path}`)
      return hostPath
    }

    for (const [prefix, root] of [
      ["/workspace", this.roots.workspace],
      ["/sdk", this.roots.sdk],
      ["/toolchain", this.roots.toolchain],
    ] as const) {
      if (path !== prefix && !path.startsWith(`${prefix}/`)) continue
      if (path.startsWith(resourcePrefix) && writing)
        throw new Error("Native Clang resources are read only")
      const suffix = path === prefix ? "" : path.slice(prefix.length + 1)
      const hostPath = resolve(root, suffix)
      if (!inside(root, hostPath))
        throw new Error(`Invalid native path: ${path}`)
      return hostPath
    }
    if (path === "/usr" || path.startsWith("/usr/")) {
      if (writing) throw new Error("Native system files are read only")
      const hostPath = resolve("/", path.slice(1))
      if (!inside("/usr", hostPath))
        throw new Error(`Invalid native system path: ${path}`)
      return hostPath
    }
    throw new Error(`Native filesystem path is unavailable: ${path}`)
  }

  async writeFile(path: string, data: Uint8Array | string) {
    if (this.disposed) throw new Error("Native compiler has been disposed")
    throwIfAborted(this.signal)
    if (
      path.startsWith(`${nativeResourcePath}/`) ||
      path === nativeResourcePath
    )
      throw new Error("Native Clang resources are read only")
    const destination = this.hostPath(path, true)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, data)
  }

  async writeTree(tree: Record<string, unknown>) {
    const visit = async (node: Record<string, unknown>, prefix: string) => {
      for (const [name, value] of Object.entries(node)) {
        if (
          !name ||
          name === "." ||
          name === ".." ||
          name.includes("/") ||
          name.includes("\\")
        )
          throw new Error(`Invalid native tree entry: ${name}`)
        const path = `${prefix}/${name}`
        if (typeof value === "string" || value instanceof Uint8Array)
          await this.writeFile(path, value)
        else if (value && typeof value === "object" && !Array.isArray(value))
          await visit(value as Record<string, unknown>, path)
        else throw new Error(`Invalid native tree entry: ${path}`)
      }
    }
    await visit(tree, "")
  }

  async readFile(path: string) {
    if (this.disposed) throw new Error("Native compiler has been disposed")
    throwIfAborted(this.signal)
    try {
      return new Uint8Array(await readFile(this.hostPath(path)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw error
    }
  }

  async remove(path: string) {
    if (this.disposed) throw new Error("Native compiler has been disposed")
    throwIfAborted(this.signal)
    if (
      path.startsWith(`${nativeResourcePath}/`) ||
      path === nativeResourcePath
    )
      throw new Error("Native Clang resources are read only")
    const target = this.hostPath(path, true)
    await rm(target, { recursive: true, force: true })
  }

  run(argv: string[], options?: SessionOptions) {
    return this.runTool(argv, options)
  }

  exec(argv: string[], options?: SessionOptions) {
    return this.runTool(argv, options)
  }

  clang(argv: string[], options?: SessionOptions) {
    return this.runTool(argv, options)
  }

  private async runTool(argv: string[], options?: SessionOptions) {
    if (this.disposed) throw new Error("Native compiler has been disposed")
    throwIfAborted(this.signal)
    const tool = argv[0]
    const executable =
      tool === "clang" || tool === "clang++"
        ? "/opt/v5x-toolchain/bin/clang"
        : tool === "ld.lld"
          ? "/opt/v5x-toolchain/bin/ld.lld"
          : undefined
    if (!executable)
      throw new Error(`Unsupported native compiler tool: ${tool}`)
    const arguments_ = argv.slice(1)
    if (tool === "clang" || tool === "clang++") {
      const compilesCxx =
        tool === "clang++" ||
        arguments_.some(
          (argument, index) =>
            (argument === "c++" && arguments_[index - 1] === "-x") ||
            /\.(cc|cp|cxx|cpp|c\+\+)$/.test(argument)
        )
      if (compilesCxx && !arguments_.includes("-nostdinc++"))
        arguments_.push("-nostdinc++")
      arguments_.push(`-resource-dir=${nativeResourcePath}`)
    }
    for (let index = 0; index < arguments_.length; index++) {
      const argument = arguments_[index]
      if (argument === "-o" && arguments_[index + 1]) {
        const output = arguments_[index + 1]
        const destination = this.hostPath(output, true)
        await mkdir(dirname(destination), { recursive: true })
        index++
      }
    }
    throwIfAborted(this.signal)
    const bwrapArguments = [
      "--unshare-all",
      "--die-with-parent",
      "--new-session",
      ...nativeSandboxEnvironment,
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind",
      "/lib64",
      "/lib64",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--bind",
      this.roots.workspace,
      "/workspace",
      "--ro-bind",
      this.roots.sdk,
      "/sdk",
      "--ro-bind",
      this.roots.toolchain,
      "/toolchain",
      "--ro-bind",
      this.resourceSource,
      nativeResourcePath,
      "--ro-bind",
      this.toolchainDirectory,
      "/opt/v5x-toolchain",
      "--chdir",
      "/workspace",
      executable,
      ...arguments_,
    ]
    const child = (() => {
      try {
        return Bun.spawn(["bwrap", ...bwrapArguments], {
          env: {
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            HOME: tmpdir(),
            TMPDIR: tmpdir(),
            LANG: "C.UTF-8",
          },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        })
      } catch (error) {
        throw new Error(
          `Could not start the required bubblewrap sandbox: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    })()
    this.processes.add(child)
    let timedOut = false
    let outputBytes = 0
    const terminate = () => {
      try {
        child.kill("SIGKILL")
      } catch {
        // The process exited before cancellation reached it.
      }
    }
    const signal = this.signal
    const onAbort = () => terminate()
    signal?.addEventListener("abort", onAbort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      terminate()
    }, this.timeoutMs)
    const forward = async (
      stream: ReadableStream<Uint8Array>,
      callback?: (bytes: Uint8Array | null) => void
    ) => {
      const reader = stream.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (!value?.byteLength) continue
          const remaining = maxCommandOutputBytes - outputBytes
          if (remaining > 0) {
            const chunk = value.subarray(0, remaining)
            outputBytes += chunk.byteLength
            callback?.(chunk)
          }
        }
      } finally {
        callback?.(null)
      }
    }
    try {
      const [exitCode] = await Promise.all([
        child.exited,
        forward(child.stdout, options?.stdout ?? undefined),
        forward(child.stderr, options?.stderr ?? undefined),
      ])
      throwIfAborted(signal)
      if (timedOut)
        throw new Error(`Native compiler command exceeded ${this.timeoutMs} ms`)
      return exitCode
    } catch (error) {
      terminate()
      if (signal?.aborted) throw abortError()
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      this.processes.delete(child)
    }
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const process of this.processes) {
      try {
        process.kill("SIGKILL")
      } catch {
        // The process exited while the session was being disposed.
      }
    }
    await Promise.allSettled(
      [...this.processes].map((process) => process.exited)
    )
    await rm(this.roots.directory, { recursive: true, force: true })
  }
}
