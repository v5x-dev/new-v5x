import { realpath, stat } from "node:fs/promises"
import { join } from "node:path"
import { BrowserBuildSession } from "@v5x/compiler/build-session"
import { buildCacheKey } from "@v5x/compiler/build-cache"
import { compileBrowserProject } from "@v5x/compiler/browser-build"
import type {
  BrowserBuildInput,
  BrowserBuildResult,
} from "@v5x/compiler/browser-build"
import type {
  BuildCompilerManifest,
  BuildSdkManifest,
} from "@v5x/compiler/build-assets"
import { assetLoader } from "./assets"
import {
  createBuildCache,
  maxCommandTimeoutMs,
  NativeFilesystem,
  nativeToolchainId,
  nativeToolchainVersion,
  throwIfAborted,
  waitForAbort,
} from "./native-filesystem"

export interface NativeCompilerOptions {
  assetsUrl: string
  cacheDirectory: string
  toolchainDirectory?: string
  commandTimeoutMs?: number
}

type ActiveBuildSession = {
  key: string
  filesystem: NativeFilesystem
  state: BrowserBuildSession
}

export class NativeCompiler {
  private readonly assets: ReturnType<typeof assetLoader>
  private readonly buildCache = createBuildCache()
  private readonly commandTimeoutMs: number
  private readonly configuredToolchain?: string
  private validatedToolchainDirectory?: string
  private active?: ActiveBuildSession
  private activeAbort?: AbortController
  private running?: Promise<BrowserBuildResult>
  private toolchainIdentity?: string
  private disposed = false

  constructor(options: NativeCompilerOptions) {
    this.assets = assetLoader(options.assetsUrl, options.cacheDirectory)
    this.configuredToolchain =
      options.toolchainDirectory ?? Bun.env.V5X_NATIVE_TOOLCHAIN
    const timeout = options.commandTimeoutMs ?? maxCommandTimeoutMs
    if (!Number.isFinite(timeout) || timeout <= 0)
      throw new Error("Native compiler command timeout must be positive")
    this.commandTimeoutMs = Math.min(timeout, maxCommandTimeoutMs)
  }

  async build(
    input: BrowserBuildInput,
    report: (text: string) => void,
    signal?: AbortSignal
  ): Promise<BrowserBuildResult> {
    if (this.disposed) throw new Error("Native compiler has been disposed")
    if (this.running) throw new Error("Native compiler is busy")
    throwIfAborted(signal)
    const controller = new AbortController()
    const forwardAbort = () => controller.abort()
    signal?.addEventListener("abort", forwardAbort, { once: true })
    this.activeAbort = controller
    const task = this.buildInternal(input, report, controller.signal)
    this.running = task
    try {
      return await task
    } finally {
      signal?.removeEventListener("abort", forwardAbort)
      if (this.running === task) this.running = undefined
      if (this.activeAbort === controller) this.activeAbort = undefined
    }
  }

  private async ensureToolchain(signal: AbortSignal) {
    if (this.toolchainIdentity) return this.toolchainIdentity
    if (!this.configuredToolchain)
      throw new Error(
        "Native ARM toolchain path is required. Pass toolchainDirectory or set V5X_NATIVE_TOOLCHAIN."
      )
    const directory = await realpath(this.configuredToolchain).catch(() => {
      throw new Error(
        `Native ARM toolchain not found at ${this.configuredToolchain}. Pass a valid toolchainDirectory or set V5X_NATIVE_TOOLCHAIN.`
      )
    })
    const clang = join(directory, "bin", "clang")
    const lld = join(directory, "bin", "ld.lld")
    const resource = join(directory, "lib", "clang", "21")
    const [clangInfo, lldInfo, resourceInfo] = await Promise.all([
      stat(clang),
      stat(lld),
      stat(resource),
    ]).catch(() => {
      throw new Error(
        "Native ARM toolchain is missing clang, ld.lld, or Clang resources"
      )
    })
    if (!clangInfo.isFile() || !lldInfo.isFile() || !resourceInfo.isDirectory())
      throw new Error(
        "Native ARM toolchain is missing clang, ld.lld, or Clang resources"
      )

    const filesystem = await NativeFilesystem.create(
      directory,
      this.commandTimeoutMs
    )
    filesystem.setSignal(signal)
    try {
      let clangOutput = ""
      const clangCode = await filesystem.exec(["clang", "--version"], {
        stdout: (bytes) => {
          if (bytes)
            clangOutput = (clangOutput + new TextDecoder().decode(bytes)).slice(
              -4096
            )
        },
      })
      let lldOutput = ""
      const lldCode = await filesystem.exec(["ld.lld", "--version"], {
        stdout: (bytes) => {
          if (bytes)
            lldOutput = (lldOutput + new TextDecoder().decode(bytes)).slice(
              -4096
            )
        },
      })
      if (
        clangCode !== 0 ||
        !clangOutput.includes(`clang version ${nativeToolchainVersion}`) ||
        !clangOutput.includes(nativeToolchainId) ||
        lldCode !== 0 ||
        !lldOutput.includes(`LLD ${nativeToolchainVersion}`)
      )
        throw new Error(
          `Unsupported native toolchain. Expected Arm LLVM ${nativeToolchainVersion} (${nativeToolchainId}).`
        )
      this.toolchainIdentity = await buildCacheKey([
        "v5x-native-arm-toolchain-v1",
        directory,
        clangOutput,
        lldOutput,
        `${clangInfo.size}:${clangInfo.mtimeMs}:${clangInfo.ino}`,
        `${lldInfo.size}:${lldInfo.mtimeMs}:${lldInfo.ino}`,
        `${resourceInfo.mtimeMs}:${resourceInfo.ino}`,
      ])
      this.validatedToolchainDirectory = directory
      return this.toolchainIdentity
    } finally {
      await filesystem.dispose()
    }
  }

  private async buildInternal(
    input: BrowserBuildInput,
    report: (text: string) => void,
    signal: AbortSignal
  ) {
    throwIfAborted(signal)
    const toolchainIdentity = await this.ensureToolchain(signal)
    const [compiler, headers, libraries] = await Promise.all([
      waitForAbort(
        this.assets.manifest<BuildCompilerManifest>(
          "/compiler/llvm-21.11.0-alpha.1/manifest.json"
        ),
        signal
      ),
      waitForAbort(
        this.assets.manifest<BuildSdkManifest>("/language/sdk-manifest.json"),
        signal
      ),
      waitForAbort(
        this.assets.manifest<BuildSdkManifest>("/compiler/sdk-manifest.json"),
        signal
      ),
    ])
    throwIfAborted(signal)
    const compilerDigest = await buildCacheKey([JSON.stringify(compiler)])
    if (
      headers.gccVersion !== libraries.gccVersion ||
      (libraries.headerDigest &&
        libraries.headerDigest !==
          (await buildCacheKey([JSON.stringify(headers)]))) ||
      (libraries.compilerDigest && libraries.compilerDigest !== compilerDigest)
    )
      throw new Error(
        "Compiler and SDK versions do not match. Retry after the asset deployment finishes."
      )

    const key = await buildCacheKey([
      compilerDigest,
      JSON.stringify(headers),
      JSON.stringify(libraries),
      input.template,
      toolchainIdentity,
    ])
    const uncertainFilesystem =
      Boolean(input.files["compile_commands.json"]) ||
      /-save-temps|-fmodules|@\/workspace/.test(
        input.files.Makefile || input.files.makefile || ""
      )
    const sessionKey = `${key}:${input.workspaceId ?? "remote"}`
    if (this.active?.key !== sessionKey || uncertainFilesystem) {
      await this.active?.filesystem.dispose()
      this.active = undefined
      if (!this.configuredToolchain)
        throw new Error(
          "Native ARM toolchain path is required. Pass toolchainDirectory or set V5X_NATIVE_TOOLCHAIN."
        )
      const toolchainDirectory = this.validatedToolchainDirectory
      if (!toolchainDirectory)
        throw new Error("Native ARM toolchain was not validated")
      const filesystem = await NativeFilesystem.create(
        toolchainDirectory,
        this.commandTimeoutMs
      )
      filesystem.setSignal(signal)
      try {
        const state = new BrowserBuildSession(filesystem)
        const files = []
        for (const [manifest, binary] of [
          [headers, false],
          [libraries, true],
        ] as const) {
          const names = manifest.templates[input.template]
          if (!names) throw new Error(`Missing ${input.template} SDK`)
          for (const name of names) {
            const asset = manifest.bundles[name]
            if (!asset) throw new Error(`Missing SDK bundle ${name}`)
            throwIfAborted(signal)
            files.push(
              ...(await waitForAbort(this.assets.bundle(asset, binary), signal))
            )
          }
        }
        await state.mount(files)
        this.active = { key: sessionKey, filesystem, state }
      } catch (error) {
        await filesystem.dispose()
        throw error
      }
    }
    const active = this.active
    if (!active) throw new Error("Native build session was not initialized")
    active.filesystem.setSignal(signal)
    throwIfAborted(signal)
    const nativeInput: BrowserBuildInput = {
      ...input,
      experiments: { ...input.experiments, pch: "off", prebuiltCold: false },
    }
    const serverOutput = (text: string) =>
      text.replaceAll("in this browser", "on the compilation server")
    return compileBrowserProject(
      active.state.session,
      nativeInput,
      headers.gccVersion,
      (text) => report(serverOutput(text)),
      {
        state: active.state,
        sdkKey: `${key}:${toolchainIdentity}`,
        cache: this.buildCache,
      }
    ).then((result) => ({ ...result, output: serverOutput(result.output) }))
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    this.activeAbort?.abort()
    await this.running?.catch(() => undefined)
    await this.active?.filesystem.dispose()
    this.active = undefined
  }
}
