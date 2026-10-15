import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(
  new URL('../public/workspace-sw.js', import.meta.url),
  'utf8',
)

function requestAsset(options: {
  url?: string
  requestHeaders?: HeadersInit
  fetch: (url: string, init?: { headers?: Headers }) => Promise<Response>
  open: () => Promise<{
    put: () => Promise<void>
    match: () => Promise<Response | undefined>
  }>
}) {
  type FetchEvent = {
    request: Request
    respondWith: (response: Promise<Response>) => void
  }
  const handlers: Record<string, (event: FetchEvent) => void> = {}
  runInNewContext(source, {
    self: {
      location: { origin: 'https://code.v5x.dev' },
      addEventListener: (
        kind: string,
        handler: (event: FetchEvent) => void,
      ) => {
        handlers[kind] = handler
      },
    },
    URL,
    Headers,
    fetch: options.fetch,
    caches: { open: options.open },
    console: { warn: () => {} },
  })
  let response: Promise<Response> | undefined
  handlers.fetch({
    request: new Request(
      options.url ?? 'https://code.v5x.dev/compiler/toolchain.wasm',
      { headers: options.requestHeaders },
    ),
    respondWith: (value) => {
      response = value
    },
  })
  return response!
}

test('serves a successful download when the cache quota is exhausted', async () => {
  const response = await requestAsset({
    fetch: async () => new Response('compiler bytes'),
    open: async () => ({
      put: async () => {
        throw new DOMException('Disk full', 'QuotaExceededError')
      },
      match: async () => undefined,
    }),
  })
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('compiler bytes')
})

test('serves a cached content-hashed file without contacting the network', async () => {
  let fetched = false
  const response = await requestAsset({
    url: 'https://code.v5x.dev/compiler/arm-34a6bf73930bf02a.bundle',
    fetch: async () => {
      fetched = true
      return new Response('fresh compiler bytes')
    },
    open: async () => ({
      put: async () => {},
      match: async () => new Response('cached compiler bytes'),
    }),
  })
  expect(await response.text()).toBe('cached compiler bytes')
  expect(fetched).toBe(false)
})

test('revalidates a cached file in a versioned directory', async () => {
  let validators = null as string | null
  const response = await requestAsset({
    url: 'https://code.v5x.dev/language/clangd-15.0.7/clangd.wasm',
    fetch: async (_url, init) => {
      validators = init?.headers?.get('If-None-Match') ?? null
      return new Response('rebuilt clangd bytes', {
        headers: { etag: '"rebuilt"' },
      })
    },
    open: async () => ({
      put: async () => {},
      match: async () =>
        new Response('stale clangd bytes', { headers: { etag: '"stale"' } }),
    }),
  })
  expect(validators).toBe('"stale"')
  expect(await response.text()).toBe('rebuilt clangd bytes')
})

test('forwards the caller validator when the service worker cache has none', async () => {
  let validators = null as string | null
  const response = await requestAsset({
    url: 'https://code.v5x.dev/compiler/sdk-manifest.json',
    requestHeaders: { 'If-None-Match': '"caller"' },
    fetch: async (_url, init) => {
      validators = init?.headers?.get('If-None-Match') ?? null
      return new Response('{"version":3}', {
        status: 200,
        headers: { etag: '"next"' },
      })
    },
    open: async () => ({
      put: async () => {},
      match: async () => undefined,
    }),
  })
  expect(validators).toBe('"caller"')
  expect(await response.text()).toBe('{"version":3}')
})

test('revalidates a manifest and keeps the cached body on 304', async () => {
  let validators = null as string | null
  const response = await requestAsset({
    url: 'https://code.v5x.dev/compiler/sdk-manifest.json',
    fetch: async (_url, init) => {
      validators = init?.headers?.get('If-None-Match') ?? null
      return new Response(null, { status: 304 })
    },
    open: async () => ({
      put: async () => {
        throw new Error('A 304 must not replace the cached manifest')
      },
      match: async () =>
        new Response('{"version":2}', { headers: { etag: '"manifest"' } }),
    }),
  })
  expect(validators).toBe('"manifest"')
  expect(await response.text()).toBe('{"version":2}')
})

test('serves a successful download when Cache Storage cannot open', async () => {
  const response = await requestAsset({
    fetch: async () => new Response('compiler bytes'),
    open: async () => {
      throw new Error('Cache Storage unavailable')
    },
  })
  expect(await response.text()).toBe('compiler bytes')
})

test('serves the cached asset when the network is offline', async () => {
  const response = await requestAsset({
    fetch: async () => {
      throw new TypeError('Failed to fetch')
    },
    open: async () => ({
      put: async () => {
        throw new Error('Offline responses must not be written back')
      },
      match: async () => new Response('cached compiler bytes'),
    }),
  })
  expect(await response.text()).toBe('cached compiler bytes')
})
