import type { BuildTimingEvent } from './build-performance'

export interface BuildCache {
  get: (key: string) => Promise<Uint8Array | undefined>
  put: (key: string, bytes: Uint8Array) => Promise<void>
}

// Bump when compiler ABI or link semantics change. Asset digests and project
// dependencies are also part of every key, so entries never cross SDK versions.
export async function buildCacheKey(parts: Array<string | Uint8Array>) {
  const encoder = new TextEncoder()
  const hashes = await Promise.all(
    parts.map(async (part) => {
      const bytes =
        typeof part === 'string' ? encoder.encode(part) : new Uint8Array(part)
      return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    }),
  )
  const joined = new Uint8Array(hashes.length * 32)
  hashes.forEach((hash, index) => joined.set(hash, index * 32))
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', joined)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}

export interface BuildCacheOptions {
  trace?: () => ((event: Omit<BuildTimingEvent, 'buildId'>) => void) | undefined
  memoryBytes?: number
  pendingBytes?: number
  persistentBytes?: number
  entries?: number
}

/** Disposable acceleration. Persistence is ordered but never gates artifact readiness. */
export function browserBuildCache(options: BuildCacheOptions = {}): BuildCache {
  const memoryLimit = options.memoryBytes ?? 32 * 1024 * 1024
  const pendingLimit = options.pendingBytes ?? 16 * 1024 * 1024
  const storageLimit = options.persistentBytes ?? 128 * 1024 * 1024
  const entryLimit = options.entries ?? 128
  const memory = new Map<string, Uint8Array>()
  const pending = new Map<
    string,
    {
      bytes: Uint8Array
      report: ReturnType<NonNullable<BuildCacheOptions['trace']>>
    }
  >()
  let memoryBytes = 0
  let pendingBytes = 0
  let draining = false
  let scheduled = false
  let persistenceBlocked = false
  const open = () => caches.open('v5x-browser-build-intermediates-v2')
  const url = (key: string) => `/__browser-build-cache/${key}`
  const remember = (key: string, bytes: Uint8Array) => {
    const previous = memory.get(key)
    if (previous) memoryBytes -= previous.byteLength
    memory.delete(key)
    if (bytes.byteLength <= memoryLimit) {
      memory.set(key, bytes)
      memoryBytes += bytes.byteLength
    }
    while (memoryBytes > memoryLimit || memory.size > entryLimit) {
      const oldest = memory.keys().next().value!
      memoryBytes -= memory.get(oldest)!.byteLength
      memory.delete(oldest)
    }
  }
  const drain = async () => {
    if (draining) return
    draining = true
    scheduled = false
    try {
      const cache = await open()
      const evictionReport = pending.values().next().value?.report
      // Keep data before metadata in submission order. A dropped blob is a miss.
      while (pending.size) {
        const [key, entry] = pending.entries().next().value!
        const { bytes, report } = entry
        const started = performance.now()
        pending.delete(key)
        pendingBytes -= bytes.byteLength
        const digest = await buildCacheKey([bytes])
        await cache.delete(url(key))
        await cache.put(
          url(key),
          new Response(new Uint8Array(bytes), {
            headers: {
              'X-Build-Digest': digest,
              'X-Build-Bytes': String(bytes.byteLength),
            },
          }),
        )
        report?.({
          clock: 'worker',
          phase: 'cache-persistence',
          start: started,
          end: performance.now(),
          outcome: 'success',
          counts: { cachedBytes: bytes.length, pendingBytes, memoryBytes },
        })
      }
      const keys = await cache.keys()
      let total = 0
      let count = 0
      let evictedEntries = 0
      let evictedBytes = 0
      const evictionStarted = performance.now()
      // Persisted hits refresh insertion order through the bounded write queue.
      // Enumerate once per batch.
      for (const key of [...keys].reverse()) {
        const response = await cache.match(key)
        const size = Number(response?.headers.get('X-Build-Bytes'))
        if (
          !Number.isSafeInteger(size) ||
          size < 0 ||
          ++count > entryLimit ||
          total + size > storageLimit
        ) {
          await cache.delete(key)
          evictedEntries++
          if (Number.isSafeInteger(size) && size >= 0) evictedBytes += size
        } else total += size
      }
      evictionReport?.({
        clock: 'worker',
        phase: 'cache-eviction',
        start: evictionStarted,
        end: performance.now(),
        outcome: 'success',
        counts: { evictedEntries, evictedBytes, persistentBytes: total },
      })
    } catch {
      // Storage denial/quota/interrupted writes are ordinary misses.
      pending.clear()
      pendingBytes = 0
    } finally {
      draining = false
      persistenceBlocked = false
      if (pending.size) schedule()
    }
  }
  const schedule = () => {
    if (!scheduled && !draining) {
      scheduled = true
      setTimeout(() => void drain(), 0)
    }
  }
  return {
    async get(key) {
      const started = performance.now()
      const report = options.trace?.()
      const complete = (hit: boolean, bytes = 0) =>
        report?.({
          clock: 'worker',
          phase: 'cache-read',
          start: started,
          end: performance.now(),
          outcome: 'success',
          counts: {
            cacheHits: hit ? 1 : 0,
            cachedBytes: bytes,
            memoryBytes,
            pendingBytes,
          },
        })
      const hit = memory.get(key)
      if (hit) {
        remember(key, hit)
        complete(true, hit.length)
        return hit.slice()
      }
      try {
        const cache = await open()
        const response = await cache.match(url(key))
        if (response) {
          const size = Number(response.headers.get('X-Build-Bytes'))
          if (!Number.isSafeInteger(size) || size < 0 || size > storageLimit)
            return undefined
          const bytes = new Uint8Array(await response.arrayBuffer())
          if (
            bytes.byteLength !== size ||
            (await buildCacheKey([bytes])) !==
              response.headers.get('X-Build-Digest')
          ) {
            await cache.delete(url(key))
            return undefined
          }
          remember(key, bytes)
          // Refresh persistent recency without delaying the returned artifact.
          if (
            !pending.has(key) &&
            bytes.length <= pendingLimit &&
            pendingBytes + bytes.length <= pendingLimit
          ) {
            pending.set(key, { bytes, report })
            pendingBytes += bytes.length
            schedule()
          }
          complete(true, bytes.length)
          return bytes.slice()
        }
      } catch {
        /* Optional storage cannot fail a build. */
      }
      complete(false)
      return undefined
    },
    put(key, bytes) {
      const owned = bytes.slice()
      remember(key, owned)
      const previous = pending.get(key)
      if (previous) {
        pendingBytes -= previous.bytes.byteLength
        pending.delete(key)
      }
      if (
        !persistenceBlocked &&
        owned.byteLength <= pendingLimit &&
        pendingBytes + owned.byteLength <= pendingLimit
      ) {
        pending.set(key, { bytes: owned, report: options.trace?.() })
        pendingBytes += owned.byteLength
      } else persistenceBlocked = true
      schedule()
      return Promise.resolve()
    },
  }
}

export function dependencyPaths(contents: string): Array<string> {
  const body = contents
    .replace(/\\\r?\n/g, '')
    .split(':')
    .slice(1)
    .join(':')
  const paths: Array<string> = []
  let word = ''
  let escaped = false
  for (const char of body) {
    if (escaped) {
      word += char
      escaped = false
    } else if (char === '\\') escaped = true
    else if (/\s/.test(char)) {
      if (word) paths.push(word)
      word = ''
    } else word += char
  }
  if (word) paths.push(word)
  return [
    ...new Set(
      paths.map((path) => {
        if (!path.startsWith('/')) return path
        const parts: Array<string> = []
        for (const part of path.split('/')) {
          if (part === '..') parts.pop()
          else if (part && part !== '.') parts.push(part)
        }
        return '/' + parts.join('/')
      }),
    ),
  ]
}
