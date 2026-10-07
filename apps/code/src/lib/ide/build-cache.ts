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

/** Disposable acceleration cache. Cache failures never prevent compilation. */
export function browserBuildCache(): BuildCache {
  const memory = new Map<string, Uint8Array>()
  const open = () => caches.open('v5x-browser-build-intermediates-v1')
  const url = (key: string) => `/__browser-build-cache/${key}`
  return {
    async get(key) {
      if (memory.has(key)) return memory.get(key)!.slice()
      try {
        const response = await (await open()).match(url(key))
        if (response) {
          const bytes = new Uint8Array(await response.arrayBuffer())
          memory.set(key, bytes)
          return bytes.slice()
        }
      } catch (error) {
        console.warn('Could not read build intermediate:', error)
      }
      return undefined
    },
    async put(key, bytes) {
      memory.set(key, bytes.slice())
      try {
        const cache = await open()
        await cache.put(url(key), new Response(new Uint8Array(bytes)))
        // Bound storage to the latest objects and cold SDKs, not every edit ever made.
        const keys = await cache.keys()
        for (const old of keys.slice(0, Math.max(0, keys.length - 128)))
          await cache.delete(old)
        while (memory.size > 128) memory.delete(memory.keys().next().value!)
      } catch (error) {
        console.warn('Could not cache build intermediate:', error)
      }
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
  return [...new Set(paths)]
}
