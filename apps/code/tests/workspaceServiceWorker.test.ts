import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(
  new URL('../public/workspace-sw.js', import.meta.url),
  'utf8',
)

function requestAsset(options: {
  fetch: () => Promise<Response>
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
    fetch: options.fetch,
    caches: { open: options.open },
    console: { warn: () => {} },
  })
  let response: Promise<Response> | undefined
  handlers.fetch({
    request: new Request('https://code.v5x.dev/compiler/toolchain.wasm'),
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
      match: async () => new Response('stale compiler bytes'),
    }),
  })
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('compiler bytes')
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
