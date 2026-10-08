import { createSession, setAssetLoader } from 'microbit-clang-wasm'
import { experimentalSourceCompiler } from './parallel-compiler'
import { BrowserBuildSession } from './build-session'
import { buildTimings } from './build-performance'
import {
  cachedBuildAsset,
  cachedBuildManifest,
  decodeBuildAsset,
  decompressBuildBytes,
  unpackBuildBundle,
} from './build-assets'
import { browserBuildCache, buildCacheKey } from './build-cache'
import { compileBrowserProject } from './browser-build'
import type { BuildTimingEvent } from './build-performance'
import type { BuildBundleFile } from './build-archive'
import type { BrowserBuildInput } from './browser-build'
import type {
  BuildAsset,
  BuildSdkManifest,
  PrebuiltColdSdk,
} from './build-assets'

const compilerBase = '/compiler/llvm-21.11.0-alpha.1/'

let cacheTrace: ((event: Omit<BuildTimingEvent, 'buildId'>) => void) | undefined
const buildCache = browserBuildCache({ trace: () => cacheTrace })
let loadedSdk: { key: string; files: Array<BuildBundleFile> } | undefined

let active: { key: string; state: BrowserBuildSession } | undefined
let manifests:
  | Promise<
      readonly [
        { files: Partial<Record<string, Omit<BuildAsset, 'url'>>> },
        BuildSdkManifest,
        BuildSdkManifest,
      ]
    >
  | undefined
let busy = false
let pendingManifests: Awaited<NonNullable<typeof manifests>> | undefined
let compilerIdentity: string | undefined
// Discovery is outside the build. Apply only at the next request boundary.
setInterval(() => {
  if (busy || !manifests) return
  void Promise.all([
    cachedBuildManifest<{
      files: Partial<Record<string, Omit<BuildAsset, 'url'>>>
    }>(compilerBase + 'manifest.json'),
    cachedBuildManifest<BuildSdkManifest>('/language/sdk-manifest.json'),
    cachedBuildManifest<BuildSdkManifest>('/compiler/sdk-manifest.json'),
  ])
    .then((next) => {
      pendingManifests = next
    })
    .catch(() => {})
}, 60_000)
let prebuiltCold:
  | {
      metadata: PrebuiltColdSdk
      symbols: Uint8Array
      binary: Uint8Array
    }
  | undefined
const stableArtifactDigests = new WeakMap<Uint8Array, Promise<string>>()
let metadataObject: Uint8Array | undefined
let mountedState: BrowserBuildSession | undefined

self.onmessage = async ({ data }: MessageEvent<BrowserBuildInput>) => {
  if (busy) return
  busy = true
  cacheTrace = data.trace
    ? (event) =>
        self.postMessage({
          kind: 'timing',
          event: { ...event, buildId: data.buildId ?? 'local' },
        })
    : undefined
  const timing = buildTimings(
    data.buildId ?? 'local',
    data.trace
      ? (event) => self.postMessage({ kind: 'timing', event })
      : undefined,
  )
  let startupOutput = ''
  let compiling = false
  const report = (text: string) => {
    if (!compiling) startupOutput += text
    self.postMessage({ kind: 'output', text })
  }
  try {
    report('Loading browser compiler and ARM SDK...\n')
    if (pendingManifests) {
      const [nextCompiler, nextHeaders, nextLibraries] = pendingManifests
      const nextIdentity = await buildCacheKey([JSON.stringify(nextCompiler)])
      if (compilerIdentity && nextIdentity !== compilerIdentity)
        throw new Error(
          'Browser compiler updated. Retry to load the new version.',
        )
      if (
        (!nextLibraries.headerDigest ||
          nextLibraries.headerDigest ===
            (await buildCacheKey([JSON.stringify(nextHeaders)]))) &&
        nextHeaders.gccVersion === nextLibraries.gccVersion
      )
        manifests = Promise.resolve(pendingManifests)
      pendingManifests = undefined
    }
    manifests ??= Promise.all([
      cachedBuildManifest<{
        files: Partial<Record<string, Omit<BuildAsset, 'url'>>>
      }>(compilerBase + 'manifest.json'),
      cachedBuildManifest<BuildSdkManifest>('/language/sdk-manifest.json'),
      cachedBuildManifest<BuildSdkManifest>('/compiler/sdk-manifest.json'),
    ])
    const [compiler, headers, libraries] = await timing.measure(
      'manifests',
      () => manifests!,
    )
    compilerIdentity = await buildCacheKey([JSON.stringify(compiler)])
    if (
      (libraries.headerDigest &&
        libraries.headerDigest !==
          (await buildCacheKey([JSON.stringify(headers)]))) ||
      (libraries.compilerDigest &&
        libraries.compilerDigest !== compilerIdentity)
    )
      throw new Error(
        'Compiler SDK deployment is incomplete. Retry after assets finish updating.',
      )
    setAssetLoader(async (name) => {
      const asset = compiler.files[name]
      if (!asset) throw new Error(`Unknown compiler asset: ${name}`)
      report(`Loading ${name}...\n`)
      const bytes = await cachedBuildAsset(
        {
          ...asset,
          url: compilerBase + name,
        },
        timing,
      )
      report(`Loaded ${name}.\n`)
      return bytes
    })
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
    const uncertainFilesystem =
      data.experiments?.freshSession ||
      Boolean(data.files['compile_commands.json']) ||
      /-save-temps|-fmodules|@\/workspace/.test(
        data.files.Makefile || data.files.makefile || '',
      )
    const sessionKey = `${sdkKey}:${uncertainFilesystem ? data.buildId : (data.workspaceId ?? data.buildId ?? crypto.randomUUID())}`
    if (active?.key !== sessionKey) {
      mountedState = undefined
      prebuiltCold = undefined
      active = {
        key: sessionKey,
        state: new BrowserBuildSession(createSession()),
      }
    }
    const { state } = active
    const session = state.session
    const mount = loadedSdk?.key !== sdkKey || state !== mountedState
    // Start WebAssembly compilation while independent SDK downloads decode.
    const ready = timing
      .measure('wasm-initialization', () =>
        session.readFile('/workspace/.browser-build/ready'),
      )
      .then(
        () => undefined,
        (error: unknown) => ({ error }),
      )
    if (loadedSdk?.key !== sdkKey) {
      const files: Array<BuildBundleFile> = []
      // Decode independent downloads together, then preserve overlay ordering.
      const precompiled = (async () => {
        const pch = libraries.precompiled?.[data.template]
        if (!pch) return []
        const [compressed, metadata] = await Promise.all([
          cachedBuildAsset(pch.binary, timing),
          cachedBuildAsset(pch.metadata, timing),
        ])
        const bytes = await timing.measure('pch-decompression', () =>
          decompressBuildBytes(compressed),
        )
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
              return timing.measure(
                binary ? 'library-bundle-load' : 'header-bundle-load',
                () => unpackBuildBundle(asset, binary, timing),
                { compressedBytes: asset.bytes },
              )
            })
          }),
        ),
        precompiled.catch(() => {
          report(
            'Optional precompiled headers unavailable; compiling normally.\n',
          )
          return []
        }),
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
    if (mount) {
      await timing.measure('sdk-mount', () => state.mount(loadedSdk!.files))
      mountedState = state
      prebuiltCold = undefined
      metadataObject = undefined
      const metadata = libraries.metadataObject
      if (
        metadata?.version === 1 &&
        metadata.compilerDigest ===
          (await buildCacheKey([JSON.stringify(compiler)]))
      ) {
        try {
          metadataObject = await cachedBuildAsset(metadata.asset, timing)
        } catch {
          report(
            'Optional build metadata unavailable; compiling timestamp normally.\n',
          )
        }
      }
      const cold = libraries.cold?.[data.template]
      if (
        cold?.version === 1 &&
        cold.compilerDigest ===
          (await buildCacheKey([JSON.stringify(compiler)]))
      ) {
        try {
          const [symbols, binary] = await timing.measure('cold-assets', () =>
            Promise.all([
              decodeBuildAsset(cold.symbols, timing),
              decodeBuildAsset(cold.binary, timing),
            ]),
          )
          prebuiltCold = { metadata: cold, symbols, binary }
        } catch {
          report('Optional cold SDK assets unavailable; linking locally.\n')
        }
      }
    }
    if (data.kind === 'preload') {
      self.postMessage({
        kind: 'preloaded',
        result: {
          commitSha: data.commitSha,
          exitCode: 0,
          output: startupOutput,
          artifacts: [],
        },
      })
      return
    }
    compiling = true
    const parallel =
      data.experiments?.parallel === 2
        ? experimentalSourceCompiler(data, compiler, headers)
        : undefined
    const result = await compileBrowserProject(
      session,
      data,
      headers.gccVersion,
      report,
      {
        cache:
          data.experiments?.cache === false
            ? {
                get: () => Promise.resolve(undefined),
                put: () => Promise.resolve(),
              }
            : buildCache,
        sdkKey,
        state,
        prebuiltCold,
        metadataObject,
        parallelCompiler: parallel,
        starterObjects: {
          entries: (libraries.starterObjects?.[data.template] ?? []).filter(
            (entry) => entry.compilerDigest === compilerIdentity,
          ),
          load: (asset) => cachedBuildAsset(asset, timing),
        },
        timing: data.trace
          ? (event) => self.postMessage({ kind: 'timing', event })
          : undefined,
      },
    ).finally(() => parallel?.dispose())
    result.output = startupOutput + result.output
    // A reference is permitted only after the client acknowledged owned bytes.
    const artifacts = await Promise.all(
      result.artifacts.map(async ({ path, bytes }) => {
        if (path !== 'bin/cold.package.bin')
          return { path, bytes: bytes.slice() }
        let digest = stableArtifactDigests.get(bytes)
        if (!digest) {
          digest = buildCacheKey([bytes])
          stableArtifactDigests.set(bytes, digest)
        }
        const identity = await digest
        return {
          path,
          digest: identity,
          size: bytes.length,
          bytes: data.knownArtifacts?.includes(identity)
            ? undefined
            : bytes.slice(),
        }
      }),
    )
    self.postMessage(
      { kind: 'result', result: { ...result, artifacts } },
      {
        transfer: artifacts.flatMap((artifact) =>
          artifact.bytes ? [artifact.bytes.buffer] : [],
        ),
      },
    )
  } catch (error) {
    active = undefined
    mountedState = undefined
    manifests = undefined
    self.postMessage({
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    busy = false
    cacheTrace = undefined
  }
}
