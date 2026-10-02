/* Cache only the explicit local shell and language assets. Never cache authenticated SSR, API, or repository responses. */
const SHELL = 'v5x-offline-shell-v1'
const LANGUAGE = 'v5x-offline-language-v1'
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch('/offline-assets.json', { cache: 'no-store' })
    if (!response.ok) throw new Error('Offline shell has not been built')
    const manifest = await response.json()
    const cache = await caches.open(SHELL)
    await cache.addAll(manifest.assets)
    await self.skipWaiting()
  })())
})
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()) })
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => {
      const response = await (await caches.open(SHELL)).match('/offline.html')
      if (!response) throw new Error('Offline workspace is not cached')
      const headers = new Headers(response.headers)
      headers.set('Cross-Origin-Opener-Policy', 'same-origin')
      headers.set('Cross-Origin-Embedder-Policy', 'credentialless')
      return new Response(response.body, { status: response.status, headers })
    }))
  } else if (url.pathname.startsWith('/language/')) {
    event.respondWith((async () => {
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
    })())
  } else {
    event.respondWith((async () => (await (await caches.open(SHELL)).match(event.request)) ?? fetch(event.request))())
  }
})
