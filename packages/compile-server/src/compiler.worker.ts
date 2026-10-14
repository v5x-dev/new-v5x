import { createSession, setAssetLoader } from "microbit-clang-wasm"
import { compileBrowserProject } from "@v5x/compiler/browser-build"
import { BrowserBuildSession } from "@v5x/compiler/build-session"
import { buildCacheKey } from "@v5x/compiler/build-cache"
import { assetLoader } from "./assets"
import type { BrowserBuildInput } from "@v5x/compiler/browser-build"
import type {
  BuildCompilerManifest,
  BuildSdkManifest,
} from "@v5x/compiler/build-assets"

let active: { key: string; state: BrowserBuildSession } | undefined
let busy = false
const cachedObjects = new Map<string, Uint8Array>()
let cachedBytes = 0
const buildCache = {
  get: async (key: string) => cachedObjects.get(key),
  put: async (key: string, bytes: Uint8Array) => {
    cachedBytes -= cachedObjects.get(key)?.byteLength ?? 0
    cachedObjects.delete(key)
    const owned = bytes.slice()
    cachedObjects.set(key, owned)
    cachedBytes += owned.byteLength
    while (cachedBytes > 64 * 1024 * 1024) {
      const oldest = cachedObjects.keys().next().value!
      cachedBytes -= cachedObjects.get(oldest)!.byteLength
      cachedObjects.delete(oldest)
    }
  },
}

self.onmessage = async ({
  data,
}: MessageEvent<{
  input: BrowserBuildInput
  assetsUrl: string
  cacheDirectory: string
}>) => {
  if (busy) return
  busy = true
  const serverOutput = (text: string) =>
    text.replaceAll("in this browser", "on the compilation server")
  const report = (text: string) =>
    self.postMessage({ type: "output", text: serverOutput(text) })
  try {
    const assets = assetLoader(data.assetsUrl, data.cacheDirectory)
    report("Loading compilation server toolchain...\n")
    const [compiler, headers, libraries] = await Promise.all([
      assets.manifest<BuildCompilerManifest>(
        "/compiler/llvm-21.11.0-alpha.1/manifest.json"
      ),
      assets.manifest<BuildSdkManifest>("/language/sdk-manifest.json"),
      assets.manifest<BuildSdkManifest>("/compiler/sdk-manifest.json"),
    ])
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
    const { input } = data
    const key = await buildCacheKey([
      compilerDigest,
      JSON.stringify(headers),
      JSON.stringify(libraries),
      input.template,
    ])
    const core =
      compiler.templateFiles?.[input.template]?.["llvm.core.wasm"] ??
      compiler.files["llvm.core.wasm"]
    setAssetLoader(
      async (name) => {
        const asset =
          compiler.templateFiles?.[input.template]?.[name] ??
          compiler.files[name]
        if (!asset) throw new Error(`Missing compiler asset: ${name}`)
        report(`Loading ${name}...\n`)
        return assets.load({
          ...asset,
          url: "/compiler/llvm-21.11.0-alpha.1/" + (asset.file ?? name),
          transportCompression: name.endsWith(".tar") ? "gzip" : undefined,
        })
      },
      compilerDigest + ":" + core?.sha256
    )
    // Custom driver commands may mutate files that normal synchronization cannot track.
    const uncertainFilesystem =
      Boolean(input.files["compile_commands.json"]) ||
      /-save-temps|-fmodules|@\/workspace/.test(
        input.files.Makefile || input.files.makefile || ""
      )
    const sessionKey = `${key}:${input.workspaceId ?? "remote"}`
    if (active?.key !== sessionKey || uncertainFilesystem) {
      const state = new BrowserBuildSession(createSession())
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
          files.push(...(await assets.bundle(asset, binary)))
        }
      }
      await state.mount(files)
      active = { key: sessionKey, state }
    }
    const cold = libraries.cold?.[input.template]
    let prebuiltCold:
      | {
          metadata: NonNullable<typeof cold>
          symbols: Uint8Array
          binary: Uint8Array
        }
      | undefined
    const metadata = libraries.metadataObject
    let metadataObject: Uint8Array | undefined
    try {
      if (cold?.compilerDigest === compilerDigest)
        prebuiltCold = {
          metadata: cold,
          symbols: await assets.decode(cold.symbols),
          binary: await assets.decode(cold.binary),
        }
    } catch {
      report("Optional cold SDK assets unavailable; linking on the server.\n")
    }
    try {
      if (metadata?.compilerDigest === compilerDigest)
        metadataObject = await assets.load(metadata.asset)
    } catch {
      report(
        "Optional build metadata unavailable; compiling timestamp on the server.\n"
      )
    }
    report("Compiling on server...\n")
    const result = await compileBrowserProject(
      active.state.session,
      input,
      headers.gccVersion,
      report,
      {
        state: active.state,
        sdkKey: key,
        cache: buildCache,
        prebuiltCold,
        metadataObject,
      }
    )
    self.postMessage({
      type: "result",
      result: { ...result, output: serverOutput(result.output) },
    })
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    busy = false
  }
}
