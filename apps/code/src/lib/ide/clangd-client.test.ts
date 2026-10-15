import { afterEach, describe, expect, test } from 'bun:test'
import { setBrowserBuildActive } from '@v5x/compiler/build-activity'
import { ClangdClient } from './clangd-client'

// Exercise the client protocol without loading the clangd WASM runtime.
class LanguageWorker {
  static current: LanguageWorker
  onmessage?: (event: { data: unknown }) => void
  messages: Array<any> = []
  respond = true

  constructor() {
    LanguageWorker.current = this
  }

  postMessage(message: any) {
    this.messages.push(message)

    if (message.kind === 'start')
      queueMicrotask(() => this.onmessage?.({ data: { kind: 'started' } }))

    if (this.respond && message.kind === 'rpc' && message.message.id)
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            kind: 'rpc',
            message: {
              jsonrpc: '2.0',
              id: message.message.id,
              result: { capabilities: {} },
            },
          },
        }),
      )
  }

  terminate() {}
}

const originalWorker = globalThis.Worker

let client: ClangdClient

async function setup() {
  globalThis.Worker = LanguageWorker as unknown as typeof Worker

  client = new ClangdClient({
    status() {},
    diagnostics() {},
    async applyEdit() {},
    error(error) {
      throw error
    },
  })

  await client.start({ 'main.cpp': '' }, 'vexcode', [], 'test')
  client.sync('main.cpp', '', 1)
  LanguageWorker.current.messages = []
  return LanguageWorker.current
}

afterEach(() => {
  setBrowserBuildActive(false)
  client.stop()
  globalThis.Worker = originalWorker
})

const changes = (worker: LanguageWorker) =>
  worker.messages.filter(
    (entry) => entry.message?.method === 'textDocument/didChange',
  )

describe('request deadlines', () => {
  test('cancels an expired request and accepts a later retry', async () => {
    const worker = await setup()
    worker.respond = false

    await expect(
      client.request('textDocument/semanticTokens/full', {}, undefined, 10),
    ).rejects.toThrow('textDocument/semanticTokens/full timed out')

    const request = worker.messages.find((entry) => entry.message?.id)
    expect(
      worker.messages.find(
        (entry) => entry.message?.method === '$/cancelRequest',
      )?.message.params.id,
    ).toBe(request.message.id)

    worker.respond = true
    await expect(
      client.request('textDocument/semanticTokens/full', {}, undefined, 100),
    ).resolves.toEqual({ capabilities: {} })
  })

  test('a longer background deadline remains abortable', async () => {
    const worker = await setup()
    worker.respond = false
    const controller = new AbortController()
    const pending = client.request(
      'textDocument/semanticTokens/full',
      {},
      controller.signal,
      100,
    )
    const result = pending.catch((error: Error) => error)

    await Bun.sleep(20)
    controller.abort()
    expect(((await result) as Error).message).toBe('Language request cancelled')
  })
})

describe('typing synchronization', () => {
  test('opens a source with one message for the filesystem and LSP', async () => {
    const worker = await setup()
    client.sync('other.cpp', 'int value = 1;', 1)

    expect(worker.messages).toEqual([
      {
        kind: 'document',
        path: 'other.cpp',
        message: {
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              uri: 'file:///workspace/other.cpp',
              languageId: 'cpp',
              version: 1,
              text: 'int value = 1;',
            },
          },
        },
      },
    ])
  })

  test('keeps the latest document during compilation and catches up afterward', async () => {
    const worker = await setup()
    setBrowserBuildActive(true)
    client.sync('main.cpp', 'old', 2)
    client.sync('main.cpp', 'new', 3)
    await Bun.sleep(150)
    expect(changes(worker)).toHaveLength(0)
    setBrowserBuildActive(false)
    expect(changes(worker)).toHaveLength(1)
    expect(changes(worker)[0].message.params.textDocument.version).toBe(3)
  })

  test('coalesces a burst into the latest document with a bounded delay', async () => {
    const worker = await setup()

    for (let version = 2; version <= 20; version++)
      client.sync('main.cpp', `text ${version}`, version)

    expect(worker.messages).toHaveLength(0)
    await Bun.sleep(150)
    expect(changes(worker)).toHaveLength(1)

    expect(changes(worker)[0].message.params).toEqual({
      textDocument: { uri: 'file:///workspace/main.cpp', version: 20 },
      contentChanges: [{ text: 'text 20' }],
    })

    expect(
      worker.messages.filter((entry) => entry.kind === 'document'),
    ).toHaveLength(1)
  })

  test('flushes the latest text before a language command', async () => {
    const worker = await setup()
    client.sync('main.cpp', 'latest', 2)
    await client.request('textDocument/completion', {})

    expect(
      worker.messages.map((entry) => entry.message?.method ?? entry.kind),
    ).toEqual(['textDocument/didChange', 'textDocument/completion'])

    await Bun.sleep(150)
    expect(changes(worker)).toHaveLength(1)
  })

  test('deleting a file cancels its queued update', async () => {
    const worker = await setup()
    client.sync('main.cpp', 'deleted', 2)
    client.remove('main.cpp')
    await Bun.sleep(150)
    expect(changes(worker)).toHaveLength(0)
  })

  test('stopping cancels queued updates', async () => {
    const worker = await setup()
    client.sync('main.cpp', 'stopped', 2)
    client.stop()
    await Bun.sleep(150)
    expect(changes(worker)).toHaveLength(0)
  })
})

test('uses the configured language service without creating a local worker', async () => {
  let requestedPath = ''
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      requestedPath = new URL(request.url).pathname
      if (
        server.upgrade(request, {
          headers: { 'Sec-WebSocket-Protocol': 'v5x-language-v1' },
        })
      )
        return
      return new Response(null, { status: 400 })
    },
    websocket: {
      open(socket) {
        socket.send(
          JSON.stringify({ type: 'ready', protocol: 'v5x-language-v1' }),
        )
      },
      message(socket, data) {
        const message = JSON.parse(String(data))
        if (message.kind === 'start')
          socket.send(JSON.stringify({ kind: 'started' }))
        else if (message.kind === 'rpc' && message.message.id)
          socket.send(
            JSON.stringify({
              kind: 'rpc',
              message: {
                jsonrpc: '2.0',
                id: message.message.id,
                result: { capabilities: {} },
              },
            }),
          )
      },
    },
  })
  globalThis.Worker = class {
    constructor() {
      throw new Error('Unexpected local language worker')
    }
  } as unknown as typeof Worker
  client = new ClangdClient(
    {
      status() {},
      diagnostics() {},
      async applyEdit() {},
      error() {},
    },
    `ws://localhost:${server.port}/compile?token=language-test-token`,
  )
  try {
    await client.start({ 'main.cpp': '' }, 'vexcode', [], 'test')
    expect(client.ready).toBe(true)
    expect(requestedPath).toBe('/language')
  } finally {
    client.stop()
    server.stop(true)
  }
})
