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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || event.request.method !== 'GET')
    return

  if (
    url.pathname.startsWith('/language/') ||
    url.pathname.startsWith('/compiler/')
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(LANGUAGE)

        try {
          const response = await fetch(event.request)
          if (response.ok) await cache.put(event.request, response.clone())
          return response
        } catch {
          const cached = await cache.match(event.request)
          if (cached) return cached
          throw new Error('Language asset has not been cached')
        }
      })(),
    )
  }
})
