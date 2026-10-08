import { decodeBuildArchive, isIndexedBuildArchive } from './build-archive'
import type { buildTimings } from './build-performance'
import type { BuildBundleFile } from './build-archive'

type AssetTiming = ReturnType<typeof buildTimings>

export interface BuildAsset {
  format?: 'indexed-v1'
  compression?: 'gzip'
  url: string
  sha256: string
  bytes: number
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
  const response =
    cached ?? (await measure('asset-download', () => fetch(asset.url)))
  if (!response.ok)
    throw new Error(`Could not download ${asset.url} (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  counts[cached ? 'cachedBytes' : 'fetchedBytes'] = bytes.length
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
