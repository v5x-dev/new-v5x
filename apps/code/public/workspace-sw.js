/* Cache language and compiler assets. Never cache authenticated SSR, API, or repository responses. */
const SHELL = 'v5x-offline-shell-v1'

const LANGUAGE = 'v5x-offline-language-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await caches.delete(SHELL)
      await self.clients.claim()
    })(),
  )
})

// Content-hashed names such as arm-34a6bf73930bf02a.bundle never change.
// Everything else, including manifests and the versioned clangd and LLVM
// directories, can be rebuilt in place and must be revalidated.
function contentHashed(pathname) {
  return /-[0-9a-f]{16}\.[^/]+$/.test(pathname)
}

async function openLanguageCache() {
  try {
    return await caches.open(LANGUAGE)
  } catch {
    return undefined
  }
}

async function serveAsset(request) {
  const url = new URL(request.url)
  const cache = await openLanguageCache()
  let cached
  try {
    cached = await cache?.match(request)
  } catch {
    cached = undefined
  }

  // Hitting the network first re-downloaded clangd and the compiler on every
  // fetch. Other cached files send their ETag so unchanged ones return 304.
  if (cached && contentHashed(url.pathname)) return cached

  try {
    const headers = new Headers()
    const etag =
      cached?.headers.get('etag') ?? request.headers.get('if-none-match')
    if (etag) headers.set('If-None-Match', etag)
    const response = await fetch(request.url, {
      headers,
      cache: 'no-store',
    })
    if (response.status === 304 && cached) return cached
    if (response.ok && cache) {
      try {
        await cache.put(request, response.clone())
      } catch (error) {
        console.warn('Could not cache workspace asset:', error)
      }
    }
    if (!response.ok && cached) return cached
    return response
  } catch (error) {
    if (cached) return cached
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || event.request.method !== 'GET')
    return

  if (
    url.pathname.startsWith('/language/') ||
    url.pathname.startsWith('/compiler/')
  )
    event.respondWith(serveAsset(event.request))
})
