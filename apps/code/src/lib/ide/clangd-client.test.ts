import { afterEach, describe, expect, test } from 'bun:test'
import { ClangdClient } from './clangd-client'

// Exercise the client protocol without loading the clangd WASM runtime.
class LanguageWorker {
  static current: LanguageWorker
  onmessage?: (event: { data: unknown }) => void
  messages: Array<any> = []

  constructor() {
    LanguageWorker.current = this
  }

  postMessage(message: any) {
    this.messages.push(message)

    if (message.kind === 'start')
      queueMicrotask(() => this.onmessage?.({ data: { kind: 'started' } }))

    if (message.kind === 'rpc' && message.message.id)
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
  client.stop()
  globalThis.Worker = originalWorker
})

const changes = (worker: LanguageWorker) =>
  worker.messages.filter(
    (entry) => entry.message?.method === 'textDocument/didChange',
  )

describe('typing synchronization', () => {
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
      worker.messages.filter((entry) => entry.kind === 'files'),
    ).toHaveLength(1)
  })

  test('flushes the latest text before a language command', async () => {
    const worker = await setup()
    client.sync('main.cpp', 'latest', 2)
    await client.request('textDocument/completion', {})

    expect(
      worker.messages.map((entry) => entry.message?.method ?? entry.kind),
    ).toEqual(['files', 'textDocument/didChange', 'textDocument/completion'])

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
