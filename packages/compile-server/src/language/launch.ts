import { constants } from "node:fs"
import { access, mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, sep } from "node:path"
import { realpath } from "node:fs/promises"
import type { ServerWebSocket } from "bun"
import { compileCommands as createCompileCommands } from "@v5x/compiler/compile-commands"
import type { BuildBundleFile } from "@v5x/compiler/build-archive"
import type { BuildSdkManifest } from "@v5x/compiler/build-assets"
import { validateRemoteInput } from "@v5x/compiler/remote-build"
import { assetLoader } from "../assets"
import {
  rewriteCompileCommand,
  validateCommands,
  maximumCommandBytes,
} from "./commands"
import { send } from "./lsp-frames"
import { isSdkVirtualPath, roots, writeVirtualFile } from "./paths"
import type { LanguageServerOptions, LanguageSocketData } from "../language"

export interface LanguageLaunchSession {
  socket: ServerWebSocket<LanguageSocketData>
  files: Map<string, string>
  closed: boolean
  stopping: boolean
  started: boolean
  root?: string
  child?: ReturnType<typeof Bun.spawn>
  reader?: ReadableStreamDefaultReader<Uint8Array>
}

export async function launchLanguageSession(
  options: LanguageServerOptions,
  session: LanguageLaunchSession,
  message: Record<string, any>,
  readOutput: (session: LanguageLaunchSession) => void,
  fail: (socket: ServerWebSocket<LanguageSocketData>, message: string) => void
) {
  send(session.socket, { kind: "status", status: "Preparing isolated SDK" })

  const validated = validateRemoteInput({
    template: message.template,
    commitSha: "language-service",
    workspaceId: message.workspaceId,
    files: message.files,
  })
  const bubblewrapPath =
    options.bubblewrapPath ?? process.env.V5X_BWRAP_PATH ?? "/usr/bin/bwrap"
  try {
    await access(bubblewrapPath, constants.X_OK)
  } catch {
    throw new Error(
      `Native language service requires executable bubblewrap at ${bubblewrapPath}. Install bubblewrap or set V5X_BWRAP_PATH; clangd will not run without the filesystem sandbox.`
    )
  }
  const configuredClangdPath =
    options.clangdPath ?? process.env.V5X_CLANGD_PATH ?? "/usr/bin/clangd"
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

  const loader = assetLoader(options.assetsUrl, options.cacheDirectory)
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
  void readOutput(session)
  void child.exited.then((code) => {
    if (session.closed || session.stopping || !session.started) return
    fail(session.socket, `clangd exited unexpectedly (${code})`)
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
