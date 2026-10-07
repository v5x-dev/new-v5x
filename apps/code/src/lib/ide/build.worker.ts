import { createSession, setAssetLoader } from 'microbit-clang-wasm'
import {
  cachedBuildAsset,
  cachedBuildManifest,
  unpackBuildBundle,
} from './build-assets'
import { browserBuildCache, buildCacheKey } from './build-cache'
import { compileBrowserProject } from './browser-build'
import type { BrowserBuildInput } from './browser-build'
import type { BuildAsset, BuildSdkManifest } from './build-assets'

const compilerBase = '/compiler/llvm-21.11.0-alpha.1/'

const buildCache = browserBuildCache()
let loadedSdk:
  | { key: string; files: Array<readonly [string, string | Uint8Array]> }
  | undefined

self.onmessage = async ({ data }: MessageEvent<BrowserBuildInput>) => {
  const report = (text: string) => self.postMessage({ kind: 'output', text })
  try {
    report('Loading browser compiler and ARM SDK...\n')
    const compiler = await cachedBuildManifest<{
      files: Partial<Record<string, Omit<BuildAsset, 'url'>>>
    }>(compilerBase + 'manifest.json')
    setAssetLoader(async (name) => {
      const asset = compiler.files[name]
      if (!asset) throw new Error(`Unknown compiler asset: ${name}`)
      report(`Loading ${name}...\n`)
      const bytes = await cachedBuildAsset({
        ...asset,
        url: compilerBase + name,
      })
      report(`Loaded ${name}.\n`)
      return bytes
    })
    const [headers, libraries] = await Promise.all([
      cachedBuildManifest<BuildSdkManifest>('/language/sdk-manifest.json'),
      cachedBuildManifest<BuildSdkManifest>('/compiler/sdk-manifest.json'),
    ])
    if (headers.gccVersion !== libraries.gccVersion)
      throw new Error('ARM headers and libraries have different versions')
    const headerNames = headers.templates[data.template]
    const binaryNames = libraries.templates[data.template]
    if (!headerNames || !binaryNames)
      throw new Error(`Missing ${data.template} SDK configuration`)
    const sdkKey = await buildCacheKey([
      JSON.stringify(compiler),
      JSON.stringify(headers),
      JSON.stringify(libraries),
      data.template,
    ])
    const session = createSession()
    // Start WebAssembly compilation while independent SDK downloads decode.
    const ready = session.writeFile('/workspace/.browser-build/ready', '').then(
      () => undefined,
      (error: unknown) => ({ error }),
    )
    if (loadedSdk?.key !== sdkKey) {
      const files: Array<readonly [string, string | Uint8Array]> = []
      // Decode independent downloads together, then preserve overlay ordering.
      const precompiled = (async () => {
        const pch = libraries.precompiled?.[data.template]
        if (!pch) return []
        const [compressed, metadata] = await Promise.all([
          cachedBuildAsset(pch.binary),
          cachedBuildAsset(pch.metadata),
        ])
        const bytes = await new Response(
          new Blob([new Uint8Array(compressed)])
            .stream()
            .pipeThrough(new DecompressionStream('gzip')),
        ).arrayBuffer()
        return [
          ['/sdk/ez/main.pch', new Uint8Array(bytes)],
          ['/sdk/ez/main-pch.json', metadata],
        ] as Array<readonly [string, Uint8Array]>
      })()
      const [bundles, pchFiles] = await Promise.all([
        Promise.all(
          [false, true].flatMap((binary) => {
            const manifest = binary ? libraries : headers
            return (binary ? binaryNames : headerNames).map(async (name) => {
              const asset = manifest.bundles[name]
              if (!asset) throw new Error(`Missing ${name} build SDK`)
              report(`Loading ${name} ${binary ? 'libraries' : 'headers'}...\n`)
              return unpackBuildBundle(asset, binary)
            })
          }),
        ),
        precompiled,
      ])
      for (const bundle of bundles) {
        for (const entry of bundle) {
          const [path] = entry
          if (
            !/^\/(sdk|toolchain|workspace)\//.test(path) ||
            path.split('/').includes('..')
          )
            throw new Error('Invalid SDK path')
          files.push(entry)
        }
      }
      files.push(...pchFiles)
      loadedSdk = { key: sdkKey, files }
    }
    const initialization = await ready
    if (initialization) throw initialization.error
    for (const [path, contents] of loadedSdk.files)
      await session.writeFile(path, contents)
    const result = await compileBrowserProject(
      session,
      data,
      headers.gccVersion,
      report,
      { cache: buildCache, sdkKey },
    )
    self.postMessage(
      { kind: 'result', result },
      {
        transfer: result.artifacts.map((artifact) => artifact.bytes.buffer),
      },
    )
  } catch (error) {
    self.postMessage({
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
