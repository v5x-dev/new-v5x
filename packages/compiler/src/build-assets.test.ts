import { gzipSync } from 'node:zlib'
import { expect, it } from 'bun:test'
import {
  cachedBuildAsset,
  decompressBuildBytes,
  streamingCompilerAsset,
} from './build-assets'

it('bounds decompression and rejects broken gzip data', async () => {
  const bytes = gzipSync('sdk bytes')
  expect(new TextDecoder().decode(await decompressBuildBytes(bytes, 9))).toBe(
    'sdk bytes',
  )
  expect(
    new TextDecoder().decode(await decompressBuildBytes(bytes, 9, 9)),
  ).toBe('sdk bytes')
  await expect(decompressBuildBytes(bytes, 8)).rejects.toThrow('size limit')
  await expect(decompressBuildBytes(bytes, 9, 8)).rejects.toThrow(
    'size mismatch',
  )
  await expect(decompressBuildBytes(new Uint8Array([1, 2]))).rejects.toThrow()
})

it('validates the decoded gzip transport against the original asset and falls back when the companion is absent', async () => {
  const originalFetch = globalThis.fetch
  const originalCaches = globalThis.caches
  const bytes = new TextEncoder().encode('compiler resource bytes')
  const sha256 = Buffer.from(
    await crypto.subtle.digest('SHA-256', bytes),
  ).toString('hex')
  const urls: string[] = []
  let absent = false
  let encoding: string | undefined
  let decoded = false
  let stored: Uint8Array | undefined
  globalThis.caches = {
    open: async () => ({
      match: async () => undefined,
      put: async (_url: string, response: Response) => {
        stored = new Uint8Array(await response.arrayBuffer())
      },
      delete: async () => true,
    }),
  } as unknown as CacheStorage
  globalThis.fetch = (async (url: string) => {
    urls.push(url)
    return url.endsWith('.gz')
      ? absent
        ? new Response(null, { status: 404 })
        : new Response(decoded ? bytes : gzipSync(bytes), {
            headers: encoding ? { 'Content-Encoding': encoding } : undefined,
          })
      : new Response(bytes)
  }) as unknown as typeof fetch
  try {
    const asset = {
      url: '/compiler/resources.tar',
      bytes: bytes.length,
      sha256,
      transportCompression: 'gzip' as const,
    }
    expect(await cachedBuildAsset(asset)).toEqual(bytes)
    expect(stored).toEqual(bytes)
    expect(urls).toEqual(['/compiler/resources.tar.gz'])
    encoding = 'br'
    expect(await cachedBuildAsset(asset)).toEqual(bytes)
    decoded = true
    encoding = 'gzip'
    expect(await cachedBuildAsset(asset)).toEqual(bytes)
    absent = true
    expect(await cachedBuildAsset(asset)).toEqual(bytes)
    expect(urls.slice(-2)).toEqual([
      '/compiler/resources.tar.gz',
      '/compiler/resources.tar',
    ])
  } finally {
    globalThis.fetch = originalFetch
    globalThis.caches = originalCaches
  }
})

function createMemoryCache(holdAssetWrites = false) {
  const entries = new Map<string, Response>()
  const puts: string[] = []
  const deletes: string[] = []
  let releaseHeldWrite: (() => void) | undefined
  const key = (value: string | URL | Request) =>
    new URL(String(value), 'http://localhost/').href
  const cache = {
    match: async (url: string | URL | Request) =>
      entries.get(key(url))?.clone(),
    put: async (url: string | URL | Request, response: Response) => {
      const cacheKey = key(url)
      puts.push(cacheKey)
      if (holdAssetWrites && cacheKey === key('/compiler/test.wasm'))
        return new Promise<void>((resolve) => {
          releaseHeldWrite = resolve
        })
      entries.set(
        cacheKey,
        new Response(await response.arrayBuffer(), {
          headers: response.headers,
        }),
      )
    },
    delete: async (url: string | URL | Request) => {
      const cacheKey = key(url)
      deletes.push(cacheKey)
      return entries.delete(cacheKey)
    },
  }
  return {
    storage: {
      open: async () => cache,
    } as unknown as CacheStorage,
    entries,
    puts,
    deletes,
    key,
    releaseHeldWrite() {
      releaseHeldWrite?.()
    },
  }
}

async function waitForCacheEntry(entries: Map<string, Response>, key: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (entries.has(key)) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`Timed out waiting for cached asset ${key}`)
}

it('streams WASM before EOF and promotes it to the offline cache only after integrity passes', async () => {
  const originalFetch = globalThis.fetch
  const originalCaches = globalThis.caches
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
  const sha256 = Buffer.from(
    await crypto.subtle.digest('SHA-256', bytes),
  ).toString('hex')
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const memoryCache = createMemoryCache()
  globalThis.caches = memoryCache.storage
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(value) {
            controller = value
            controller.enqueue(bytes.subarray(0, 4))
          },
        }),
      ),
    )) as unknown as typeof fetch
  try {
    const asset = { url: '/compiler/test.wasm', bytes: bytes.length, sha256 }
    const response = await streamingCompilerAsset(asset)
    const reader = response.body!.getReader()
    expect((await reader.read()).value).toEqual(bytes.subarray(0, 4))
    const canonicalKey = memoryCache.key(asset.url)
    expect(memoryCache.puts).not.toContain(canonicalKey)
    controller.enqueue(bytes.subarray(4))
    controller.close()
    expect((await reader.read()).value).toEqual(bytes.subarray(4))
    expect((await reader.read()).done).toBe(true)
    await waitForCacheEntry(memoryCache.entries, canonicalKey)
    expect(
      new Uint8Array(
        await memoryCache.entries.get(canonicalKey)!.clone().arrayBuffer(),
      ),
    ).toEqual(bytes)
    expect(memoryCache.puts).toContain(canonicalKey)

    globalThis.fetch = (() => {
      throw new Error('Network should not be used for a cached compiler asset')
    }) as unknown as typeof fetch
    const cachedResponse = await streamingCompilerAsset(asset)
    expect(await WebAssembly.compileStreaming(cachedResponse)).toBeInstanceOf(
      WebAssembly.Module,
    )
  } finally {
    globalThis.fetch = originalFetch
    globalThis.caches = originalCaches
  }
})

it('rejects corrupt WASM at EOF and never promotes it to the offline cache', async () => {
  const originalFetch = globalThis.fetch
  const originalCaches = globalThis.caches
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
  const memoryCache = createMemoryCache()
  globalThis.caches = memoryCache.storage
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(value) {
            value.enqueue(bytes)
            value.close()
          },
        }),
      ),
    )) as unknown as typeof fetch
  try {
    const response = await streamingCompilerAsset({
      url: '/compiler/test.wasm',
      bytes: bytes.length,
      sha256: '0'.repeat(64),
    })
    await expect(WebAssembly.compileStreaming(response)).rejects.toThrow(
      'checksum mismatch',
    )
    expect(memoryCache.puts).not.toContain(
      memoryCache.key('/compiler/test.wasm'),
    )
    expect(
      memoryCache.entries.has(memoryCache.key('/compiler/test.wasm')),
    ).toBe(false)
    expect(
      memoryCache.deletes.some((key) => key.includes('__v5x_asset_stage')),
    ).toBe(true)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.caches = originalCaches
  }
})

it('does not wait for the final offline cache write before compilation succeeds', async () => {
  const originalFetch = globalThis.fetch
  const originalCaches = globalThis.caches
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
  const sha256 = Buffer.from(
    await crypto.subtle.digest('SHA-256', bytes),
  ).toString('hex')
  const memoryCache = createMemoryCache(true)
  globalThis.caches = memoryCache.storage
  globalThis.fetch = (() =>
    Promise.resolve(new Response(bytes))) as unknown as typeof fetch
  try {
    const response = await streamingCompilerAsset({
      url: '/compiler/test.wasm',
      bytes: bytes.length,
      sha256,
    })
    expect(await WebAssembly.compileStreaming(response)).toBeInstanceOf(
      WebAssembly.Module,
    )
    expect(memoryCache.puts).toContain(memoryCache.key('/compiler/test.wasm'))
    memoryCache.releaseHeldWrite()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(
      memoryCache.deletes.some((key) => key.includes('__v5x_asset_stage')),
    ).toBe(true)
  } finally {
    memoryCache.releaseHeldWrite()
    globalThis.fetch = originalFetch
    globalThis.caches = originalCaches
  }
})
