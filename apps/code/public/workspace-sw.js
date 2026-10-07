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
        let response
        try {
          response = await fetch(event.request)
        } catch {
          const cache = await caches.open(LANGUAGE)
          const cached = await cache.match(event.request)
          if (cached) return cached
          throw new Error('Language asset has not been cached')
        }

        if (response.ok) {
          try {
            const cache = await caches.open(LANGUAGE)
            await cache.put(event.request, response.clone())
          } catch (error) {
            console.warn('Could not cache workspace asset:', error)
          }
        }
        return response
      })(),
    )
  }
})
