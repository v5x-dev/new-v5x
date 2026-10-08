import { describe, expect, it } from 'bun:test'
import { buildCacheKey, dependencyPaths } from './build-cache'

describe('build cache dependencies', () => {
  it('separates ordered inputs and invalidates changed bytes', async () => {
    expect(await buildCacheKey(['ab', 'c'])).not.toBe(
      await buildCacheKey(['a', 'bc']),
    )
    expect(await buildCacheKey(['sdk-v1', new Uint8Array([1])])).not.toBe(
      await buildCacheKey(['sdk-v2', new Uint8Array([1])]),
    )
    expect(await buildCacheKey(['header', new Uint8Array([1])])).not.toBe(
      await buildCacheKey(['header', new Uint8Array([2])]),
    )
    expect(await buildCacheKey(['header', new Uint8Array([1])])).toBe(
      await buildCacheKey(['header', new Uint8Array([1])]),
    )
  })

  it('reads compiler dependency files with escaped spaces and continued lines', () => {
    expect(
      dependencyPaths(
        'main.o: /workspace/src/main.cpp \\\r\n /workspace/include/my\\ header.h /workspace/include/my\\ header.h\n',
      ),
    ).toEqual(['/workspace/src/main.cpp', '/workspace/include/my header.h'])
    expect(
      dependencyPaths('main.o: /workspace/include/path:with:colons.h\n'),
    ).toEqual(['/workspace/include/path:with:colons.h'])
  })
})

describe('optional intermediate storage', () => {
  it('publishes owned memory before a stalled persistence write and survives transfer', async () => {
    const { browserBuildCache } = await import('./build-cache')
    const original = globalThis.caches
    let writes = 0
    globalThis.caches = {
      open: async () => ({
        match: async () => undefined,
        delete: async () => true,
        put: async () => {
          writes++
          await new Promise(() => {})
        },
        keys: async () => [],
      }),
    } as unknown as CacheStorage
    try {
      const cache = browserBuildCache({ memoryBytes: 4, pendingBytes: 4 })
      const bytes = new Uint8Array([1, 2])
      await cache.put('first', bytes)
      bytes[0] = 9
      const hit = (await cache.get('first'))!
      expect([...hit]).toEqual([1, 2])
      structuredClone(hit, { transfer: [hit.buffer] })
      expect([...(await cache.get('first'))!]).toEqual([1, 2])
      await Bun.sleep(20)
      expect(writes).toBe(1)
      await cache.put('second', new Uint8Array([3, 4, 5]))
      expect(await cache.get('first')).toBeUndefined()
      expect([...(await cache.get('second'))!]).toEqual([3, 4, 5])
    } finally {
      globalThis.caches = original
    }
  })

  it('treats storage denial as a miss while retaining bounded memory', async () => {
    const { browserBuildCache } = await import('./build-cache')
    const original = globalThis.caches
    globalThis.caches = {
      open: async () => {
        throw new Error('Denied')
      },
    } as unknown as CacheStorage
    try {
      const cache = browserBuildCache({ memoryBytes: 2, pendingBytes: 0 })
      await cache.put('one', new Uint8Array([1, 2]))
      await cache.put('two', new Uint8Array([3, 4]))
      expect(await cache.get('one')).toBeUndefined()
      expect([...(await cache.get('two'))!]).toEqual([3, 4])
    } finally {
      globalThis.caches = original
    }
  })
})

it('refreshes persistent recency across cache owners and reports bounded eviction', async () => {
  const { browserBuildCache } = await import('./build-cache')
  const original = globalThis.caches
  const entries = new Map<string, Response>()
  const key = (input: string | Request) =>
    typeof input === 'string' ? input : new URL(input.url).pathname
  globalThis.caches = {
    open: () =>
      Promise.resolve({
        match: (input: string | Request) =>
          Promise.resolve(entries.get(key(input))?.clone()),
        delete: (input: string | Request) =>
          Promise.resolve(entries.delete(key(input))),
        put: (input: string | Request, response: Response) => {
          entries.set(key(input), response.clone())
          return Promise.resolve()
        },
        keys: () =>
          Promise.resolve(
            [...entries.keys()].map(
              (path) => new Request('http://localhost' + path),
            ),
          ),
      }),
  } as unknown as CacheStorage
  try {
    const first = browserBuildCache({ entries: 2, memoryBytes: 0 })
    await first.put('a', new Uint8Array([1]))
    await first.put('b', new Uint8Array([2]))
    await Bun.sleep(30)
    const events: Array<{ counts?: Record<string, number> }> = []
    const second = browserBuildCache({
      entries: 2,
      memoryBytes: 0,
      trace: () => (event) => events.push(event),
    })
    expect([...(await second.get('a'))!]).toEqual([1])
    await Bun.sleep(30)
    await second.put('c', new Uint8Array([3]))
    await Bun.sleep(30)
    expect(await first.get('b')).toBeUndefined()
    expect([...(await first.get('a'))!]).toEqual([1])
    expect(entries.size).toBe(2)
    expect(events.some((event) => event.counts?.evictedEntries === 1)).toBe(
      true,
    )
  } finally {
    globalThis.caches = original
  }
})
