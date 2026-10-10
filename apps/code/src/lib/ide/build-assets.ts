import { decodeBuildArchive, isIndexedBuildArchive } from './build-archive'
import type { buildTimings } from './build-performance'
import type { BuildBundleFile } from './build-archive'
import type { CompilerPlan } from './compiler-plan'

type AssetTiming = ReturnType<typeof buildTimings>

export interface BuildAsset {
  file?: string
  transportCompression?: 'gzip'
  format?: 'indexed-v1'
  compression?: 'gzip'
  url: string
  sha256: string
  bytes: number
}

export interface BuildCompilerManifest {
  files: Partial<Record<string, Omit<BuildAsset, 'url'>>>
  templateFiles?: Partial<
    Record<string, Partial<Record<string, Omit<BuildAsset, 'url'>>>>
  >
}

export interface PrebuiltColdSdk {
  version: 1
  compilerDigest: string
  inputsDigest: string
  elf: BuildAsset
  symbols: BuildAsset
  binary: BuildAsset
}

export interface StarterObject {
  version: number
  compilerDigest: string
  gccVersion: string
  arguments: Array<string>
  paths: Array<string>
  digest: string
  inventory: Array<string>
  sourceDigest: string
  asset: BuildAsset
}

export interface BuildSdkManifest {
  compilerPlans?: {
    compilerDigest: string
    templates: Partial<Record<string, Array<CompilerPlan>>>
  }
  headerDigest?: string
  compilerDigest?: string
  starterObjects?: Partial<Record<string, Array<StarterObject>>>
  metadataObject?: { version: 1; compilerDigest: string; asset: BuildAsset }
  cold?: Partial<Record<string, PrebuiltColdSdk>>
  version: number
  gccVersion: string
  templates: Partial<Record<string, Array<string>>>
  bundles: Partial<Record<string, BuildAsset>>
  precompiled?: Partial<
    Record<string, { binary: BuildAsset; metadata: BuildAsset }>
  >
}

export async function cachedBuildAsset(
  asset: BuildAsset,
  timing?: AssetTiming,
): Promise<Uint8Array> {
  const cache = await caches
    .open('v5x-browser-build-assets-v1')
    .catch(() => undefined)
  const counts = { fetchedBytes: 0, cachedBytes: 0, hashedBytes: 0 }
  const measure =
    timing?.measure ??
    (async <T>(_phase: string, work: () => Promise<T>) => work())
  const cached = await measure('asset-cache-read', async () =>
    cache?.match(asset.url).catch(() => undefined),
  )
  let compressed = false
  const response =
    cached ??
    (await measure('asset-download', async () => {
      if (asset.transportCompression === 'gzip') {
        const encoded = await fetch(asset.url + '.gz').catch(() => undefined)
        if (encoded?.ok) {
          compressed = true
          return encoded
        }
      }
      return fetch(asset.url)
    }))
  if (!response.ok)
    throw new Error(`Could not download ${asset.url} (${response.status})`)
  const transferred = new Uint8Array(await response.arrayBuffer())
  // HTTP may compress the .gz file again. Fetch removes that outer layer,
  // so inspect the remaining payload rather than Content-Encoding.
  const bytes =
    compressed && transferred[0] === 0x1f && transferred[1] === 0x8b
      ? new Uint8Array(await decompressBuildBytes(transferred, asset.bytes))
      : transferred
  counts[cached ? 'cachedBytes' : 'fetchedBytes'] = transferred.length
  counts.hashedBytes = bytes.length
  const digest = Array.from(
    new Uint8Array(
      await measure(
        'asset-integrity',
        () => crypto.subtle.digest('SHA-256', bytes),
        counts,
      ),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
  if (bytes.byteLength !== asset.bytes || digest !== asset.sha256) {
    await cache?.delete(asset.url).catch(() => false)
    throw new Error(`Build asset checksum mismatch: ${asset.url}`)
  }
  if (!cached) {
    await cache
      ?.put(
        asset.url,
        new Response(bytes, {
          headers: {
            'Content-Type': asset.url.endsWith('.wasm')
              ? 'application/wasm'
              : 'application/octet-stream',
          },
        }),
      )
      .catch((error) => console.warn('Could not cache compiler asset:', error))
  }
  return bytes
}

/** Compile incoming WASM chunks while downloading; EOF is gated on integrity. */
export async function streamingCompilerAsset(
  asset: BuildAsset,
  timing?: AssetTiming,
): Promise<Response> {
  if (
    !Number.isSafeInteger(asset.bytes) ||
    asset.bytes <= 0 ||
    asset.bytes > 128 * 1024 * 1024
  )
    throw new Error('Invalid compiler asset size')
  const cache = await caches
    .open('v5x-browser-build-assets-v1')
    .catch(() => undefined)
  const measure =
    timing?.measure ??
    (async <T>(_phase: string, work: () => Promise<T>) => work())
  const cached = await measure('asset-cache-read', async () =>
    cache?.match(asset.url).catch(() => undefined),
  )
  const response =
    cached ?? (await measure('asset-download', () => fetch(asset.url)))
  if (!response.ok || !response.body)
    throw new Error(`Could not download ${asset.url} (${response.status})`)
  const reader = response.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await measure(
          'wasm-stream-download',
          async () => {
            const bytes = new Uint8Array(asset.bytes)
            let offset = 0
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (offset + value.length > bytes.length)
                throw new Error(`Build asset checksum mismatch: ${asset.url}`)
              bytes.set(value, offset)
              offset += value.length
              controller.enqueue(value)
            }
            const digest = Array.from(
              new Uint8Array(
                await measure('asset-integrity', () =>
                  crypto.subtle.digest('SHA-256', bytes),
                ),
              ),
              (byte) => byte.toString(16).padStart(2, '0'),
            ).join('')
            if (offset !== asset.bytes || digest !== asset.sha256)
              throw new Error(`Build asset checksum mismatch: ${asset.url}`)
            // Cache persistence must not delay compilation or the first build.
            if (!cached)
              void cache
                ?.put(
                  asset.url,
                  new Response(bytes, {
                    headers: { 'Content-Type': 'application/wasm' },
                  }),
                )
                .catch((error) =>
                  console.warn('Could not cache compiler asset:', error),
                )
            controller.close()
          },
          { [cached ? 'cachedBytes' : 'fetchedBytes']: asset.bytes },
        )
      } catch (error) {
        await reader.cancel().catch(() => {})
        await cache?.delete(asset.url).catch(() => false)
        controller.error(error)
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
  return new Response(body, { headers: { 'Content-Type': 'application/wasm' } })
}

export async function cachedBuildManifest<T>(url: string): Promise<T> {
  const cache = await caches
    .open('v5x-browser-build-assets-v1')
    .catch(() => undefined)
  let response: Response
  try {
    response = await fetch(url, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`Build manifest is missing: ${url}`)
  } catch (error) {
    const cached = await cache?.match(url).catch(() => undefined)
    if (cached) return cached.json()
    throw error
  }
  const value: T = await response.clone().json()
  await cache
    ?.put(url, response)
    .catch((error) => console.warn('Could not cache compiler manifest:', error))
  return value
}

export async function unpackBuildBundle(
  asset: BuildAsset,
  binary: boolean,
  timing?: AssetTiming,
): Promise<Array<BuildBundleFile>> {
  const bytes = await cachedBuildAsset(asset, timing)
  const decompressed = timing
    ? await timing.measure('bundle-decompression', () =>
        decompressBuildBytes(bytes),
      )
    : await decompressBuildBytes(bytes)
  if (isIndexedBuildArchive(decompressed))
    return decodeBuildArchive(decompressed)
  if (asset.format === 'indexed-v1')
    throw new Error('Missing indexed build archive header')
  const bundle = JSON.parse(new TextDecoder().decode(decompressed)) as {
    files?: Record<string, unknown>
  }
  if (
    !bundle.files ||
    typeof bundle.files !== 'object' ||
    Array.isArray(bundle.files) ||
    Object.keys(bundle.files).length > 20000
  )
    throw new Error('Invalid build SDK index')
  return Object.entries(bundle.files).map(([path, contents]) => {
    if (
      typeof contents !== 'string' ||
      path.length > 4096 ||
      !/^\/(sdk|toolchain|workspace)\//.test(path) ||
      path.includes('\0') ||
      path
        .split('/')
        .slice(1)
        .some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('Invalid build SDK entry')
    return [
      path,
      binary
        ? Uint8Array.from(atob(contents), (char) => char.charCodeAt(0))
        : contents,
    ] as const
  })
}

export async function decodeBuildAsset(
  asset: BuildAsset,
  timing?: AssetTiming,
) {
  const bytes = await cachedBuildAsset(asset, timing)
  if (asset.compression !== 'gzip') return bytes
  return decompressBuildBytes(bytes)
}

/** Bound inflation before parsing or mounting downloaded SDK/PCH/cold data. */
export async function decompressBuildBytes(
  bytes: Uint8Array,
  limit = 256 * 1024 * 1024,
) {
  const reader = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader()
  const chunks: Array<Uint8Array> = []
  let length = 0
  try {
    let chunk = await reader.read()
    while (!chunk.done) {
      const value = chunk.value
      length += value.byteLength
      if (length > limit) {
        await reader.cancel()
        throw new Error('Build asset exceeds decompressed size limit')
      }
      chunks.push(value)
      chunk = await reader.read()
    }
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}
