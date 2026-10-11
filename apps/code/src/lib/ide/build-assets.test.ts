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
  await expect(decompressBuildBytes(bytes, 8)).rejects.toThrow('size limit')
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

it('streams WASM before EOF, checks integrity before compilation completes, and does not wait for cache writes', async () => {
  const originalFetch = globalThis.fetch
  const originalCaches = globalThis.caches
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
  const sha256 = Buffer.from(
    await crypto.subtle.digest('SHA-256', bytes),
  ).toString('hex')
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let writes = 0
  let deletes = 0
  globalThis.caches = {
    open: async () => ({
      match: async () => undefined,
      put: () => {
        writes++
        return new Promise(() => {})
      },
      delete: async () => {
        deletes++
        return true
      },
    }),
  } as unknown as CacheStorage
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
    expect(writes).toBe(0)
    controller.enqueue(bytes.subarray(4))
    controller.close()
    expect((await reader.read()).value).toEqual(bytes.subarray(4))
    expect((await reader.read()).done).toBe(true)
    expect(writes).toBe(1)
    const corrupt = await streamingCompilerAsset({
      ...asset,
      sha256: '0'.repeat(64),
    })
    controller.enqueue(bytes.subarray(4))
    controller.close()
    await expect(WebAssembly.compileStreaming(corrupt)).rejects.toThrow(
      'checksum mismatch',
    )
    expect(deletes).toBe(1)
    expect(writes).toBe(1)
    const valid = await streamingCompilerAsset(asset)
    controller.enqueue(bytes.subarray(4))
    controller.close()
    expect(await WebAssembly.compileStreaming(valid)).toBeInstanceOf(
      WebAssembly.Module,
    )
  } finally {
    globalThis.fetch = originalFetch
    globalThis.caches = originalCaches
  }
})
