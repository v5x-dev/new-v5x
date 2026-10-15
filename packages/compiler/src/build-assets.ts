import { sha256 } from '@noble/hashes/sha2.js'
import { decodeBuildArchive, isIndexedBuildArchive } from './build-archive'
import type { buildTimings } from './build-performance'
import type { BuildBundleFile } from './build-archive'
import type { CompilerPlan } from './compiler-plan'

type AssetTiming = ReturnType<typeof buildTimings>
const maxCompilerAssetBytes = 64 * 1024 * 1024
const maxDecompressedBuildBytes = 32 * 1024 * 1024

const assetCaches = new WeakMap<CacheStorage, Promise<Cache | undefined>>()
function openAssetCache() {
  const storage = globalThis.caches
  if (!storage) return Promise.resolve(undefined)
  let cache = assetCaches.get(storage)
  if (!cache) {
    cache = storage.open('v5x-browser-build-assets-v1').catch(() => {
      assetCaches.delete(storage)
      return undefined
    })
    assetCaches.set(storage, cache)
  }
  return cache
}

let decompressionQueue: Promise<void> = Promise.resolve()
let cacheStageId = 0

function createCacheStageUrl(assetUrl: string) {
  const url = new URL(
    assetUrl,
    globalThis.location?.href ?? 'http://localhost/',
  )
  url.searchParams.set(
    '__v5x_asset_stage',
    `${Date.now().toString(36)}-${(++cacheStageId).toString(36)}-${Math.random()
      .toString(36)
      .slice(2)}`,
  )
  return url.href
}

function responseFromBytes(bytes: Uint8Array, headers: HeadersInit) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  return new Response(body as BodyInit, { headers })
}

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
  if (
    !Number.isSafeInteger(asset.bytes) ||
    asset.bytes <= 0 ||
    asset.bytes > maxCompilerAssetBytes
  )
    throw new Error('Invalid build asset size')
  const cache = await openAssetCache()
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
  let bytes = new Uint8Array(await response.arrayBuffer())
  const transferredBytes = bytes.byteLength
  // HTTP may compress the .gz file again. Fetch removes that outer layer,
  // so inspect the remaining payload rather than Content-Encoding.
  if (compressed && bytes[0] === 0x1f && bytes[1] === 0x8b)
    bytes = await decompressBuildBytes(bytes, asset.bytes, asset.bytes)
  counts[cached ? 'cachedBytes' : 'fetchedBytes'] = transferredBytes
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
        responseFromBytes(bytes, {
          'Content-Type': asset.url.endsWith('.wasm')
            ? 'application/wasm'
            : 'application/octet-stream',
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
    asset.bytes > maxCompilerAssetBytes
  )
    throw new Error('Invalid compiler asset size')
  const cache = await openAssetCache()
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
  const hasher = sha256.create()
  const counts = {
    fetchedBytes: 0,
    cachedBytes: 0,
    hashedBytes: 0,
  }
  const reportTransfer = (() => {
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const work = measure(
      'wasm-stream-download',
      () =>
        new Promise<void>((done, fail) => {
          resolve = done
          reject = fail
        }),
      counts,
    )
    void work.catch(() => {})
    return {
      resolve() {
        resolve()
      },
      reject(error: unknown) {
        reject(error)
      },
    }
  })()
  let transferSettled = false
  const settleTransfer = (success: boolean, error?: unknown) => {
    if (transferSettled) return
    transferSettled = true
    if (success) reportTransfer.resolve()
    else reportTransfer.reject(error)
  }

  const stageUrl = !cached && cache ? createCacheStageUrl(asset.url) : undefined
  let stageWriteFailed = false
  let stageWriter: WritableStreamDefaultWriter<Uint8Array> | undefined
  let stagePut: Promise<void> | undefined
  if (stageUrl && cache) {
    const stage = new TransformStream<Uint8Array, Uint8Array>(
      undefined,
      { highWaterMark: 1 },
      { highWaterMark: 0 },
    )
    stageWriter = stage.writable.getWriter()
    stagePut = Promise.resolve()
      .then(() =>
        cache.put(
          stageUrl,
          new Response(stage.readable, {
            headers: { 'Content-Type': 'application/wasm' },
          }),
        ),
      )
      .then(
        () => {},
        (error) => {
          stageWriteFailed = true
          if (
            !(error instanceof Error) ||
            !error.message.includes('checksum mismatch')
          )
            console.warn('Could not stage compiler asset cache:', error)
        },
      )
  }

  const discardStage = async (reason: unknown) => {
    if (!stageUrl || !cache) return
    await stageWriter?.abort(reason).catch(() => {})
    await stagePut
    await cache.delete(stageUrl).catch(() => false)
  }

  const finishStage = async () => {
    if (!stageUrl || !cache || !stageWriter || !stagePut) return
    try {
      await stageWriter.close()
      await stagePut
      if (stageWriteFailed) return
      const staged = await cache.match(stageUrl).catch(() => undefined)
      if (staged) await cache.put(asset.url, staged)
    } catch (error) {
      console.warn('Could not cache compiler asset:', error)
    } finally {
      await cache.delete(stageUrl).catch(() => false)
    }
  }

  let offset = 0
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            const digest = await measure('asset-integrity', async () =>
              Array.from(hasher.digest(), (byte) =>
                byte.toString(16).padStart(2, '0'),
              ).join(''),
            )
            if (offset !== asset.bytes || digest !== asset.sha256)
              throw new Error(`Build asset checksum mismatch: ${asset.url}`)

            settleTransfer(true)
            controller.close()
            void finishStage()
            return
          }

          if (offset + value.byteLength > asset.bytes)
            throw new Error(`Build asset checksum mismatch: ${asset.url}`)

          offset += value.byteLength
          hasher.update(value)
          counts[cached ? 'cachedBytes' : 'fetchedBytes'] += value.byteLength
          counts.hashedBytes += value.byteLength
          controller.enqueue(value)
          if (stageWriter && !stageWriteFailed) {
            try {
              await stageWriter.write(value)
            } catch {
              stageWriteFailed = true
            }
          }
        } catch (error) {
          settleTransfer(false, error)
          await reader.cancel().catch(() => {})
          await discardStage(error)
          if (cached) await cache?.delete(asset.url).catch(() => false)
          controller.error(error)
        }
      },
      async cancel(reason) {
        settleTransfer(false, reason)
        await reader.cancel(reason).catch(() => {})
        await discardStage(reason)
      },
    },
    { highWaterMark: 0 },
  )
  return new Response(body, { headers: { 'Content-Type': 'application/wasm' } })
}

export async function cachedBuildManifest<T>(url: string): Promise<T> {
  const cache = await openAssetCache()
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
    if (!binary) return [path, contents] as const

    const decoded = atob(contents)
    const bytes = new Uint8Array(decoded.length)
    for (let index = 0; index < decoded.length; index++)
      bytes[index] = decoded.charCodeAt(index)
    return [path, bytes] as const
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
  limit = maxDecompressedBuildBytes,
  expectedBytes?: number,
) {
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new Error('Invalid build asset size limit')

  const gzipBytes =
    bytes.byteLength >= 18 && bytes[0] === 0x1f && bytes[1] === 0x8b
      ? new DataView(
          bytes.buffer,
          bytes.byteOffset + bytes.byteLength - 4,
          4,
        ).getUint32(0, true)
      : undefined
  const outputBytes = expectedBytes ?? gzipBytes
  if (
    outputBytes !== undefined &&
    (!Number.isSafeInteger(outputBytes) ||
      outputBytes < 0 ||
      outputBytes > limit)
  )
    throw new Error('Build asset exceeds decompressed size limit')

  const previous = decompressionQueue
  let release!: () => void
  decompressionQueue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous

  try {
    const source = new ReadableStream<BufferSource>({
      start(controller) {
        controller.enqueue(bytes as BufferSource)
        controller.close()
      },
    })
    const reader = source
      .pipeThrough(new DecompressionStream('gzip'))
      .getReader()
    if (outputBytes !== undefined) {
      const output = new Uint8Array(outputBytes)
      let offset = 0
      try {
        let chunk = await reader.read()
        while (!chunk.done) {
          const value = chunk.value
          if (offset + value.byteLength > output.byteLength) {
            await reader.cancel()
            throw new Error('Build asset decompressed size mismatch')
          }
          output.set(value, offset)
          offset += value.byteLength
          chunk = await reader.read()
        }
      } finally {
        reader.releaseLock()
      }
      if (offset !== output.byteLength)
        throw new Error('Build asset decompressed size mismatch')
      return output
    }

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
  } finally {
    release()
  }
}
