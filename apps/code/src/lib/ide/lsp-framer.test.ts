import { readFileSync } from 'node:fs'
import { expect, test } from 'bun:test'

const source = readFileSync(
  new URL('../../../public/language/clangd-host.js', import.meta.url),
  'utf8',
)
const start = source.indexOf('function createLspStdout')
const end = source.indexOf('const stdout = createLspStdout')

const createLspStdout = new Function(
  `${source.slice(start, end)}; return createLspStdout`,
)() as (
  onMessage: (message: unknown) => void,
  onError: (message: string) => void,
  maxMessage?: number,
) => (byte: number) => void

function feed(push: (byte: number) => void, message: unknown) {
  const json = JSON.stringify(message)
  const bytes = new TextEncoder().encode(
    `Content-Length: ${json.length}\r\n\r\n${json}`,
  )

  for (const byte of bytes) push(byte)
}

test('reads a framed clangd message without retaining the byte buffer', () => {
  const messages: Array<unknown> = []
  const push = createLspStdout(
    (message) => messages.push(message),
    () => {
      throw new Error('unexpected overflow')
    },
  )

  feed(push, { jsonrpc: '2.0', id: 1, result: { items: [{ label: 'ok' }] } })
  feed(push, { jsonrpc: '2.0', id: 2, result: null })

  expect(messages).toEqual([
    { jsonrpc: '2.0', id: 1, result: { items: [{ label: 'ok' }] } },
    { jsonrpc: '2.0', id: 2, result: null },
  ])
})

test('drops an oversized completion reply and keeps the following message', () => {
  const messages: Array<unknown> = []
  const errors: Array<string> = []
  const push = createLspStdout(
    (message) => messages.push(message),
    (message) => errors.push(message),
    30,
  )
  const oversized = new TextEncoder().encode(
    'Content-Length: 40\r\n\r\n' + 'x'.repeat(40),
  )

  for (const byte of oversized) push(byte)
  feed(push, { id: 3 })

  expect(errors).toEqual(['Clangd response exceeded the memory limit'])
  expect(messages).toEqual([{ id: 3 }])
})

test('recovers when a completion payload is not valid JSON', () => {
  const messages: Array<unknown> = []
  const errors: Array<string> = []
  const push = createLspStdout(
    (message) => messages.push(message),
    (message) => errors.push(message),
  )
  const broken = new TextEncoder().encode('Content-Length: 4\r\n\r\nxxxx')

  for (const byte of broken) push(byte)
  feed(push, { jsonrpc: '2.0', id: 4, result: { items: [] } })

  expect(errors).toEqual(['Clangd response could not be read'])
  expect(messages).toEqual([{ jsonrpc: '2.0', id: 4, result: { items: [] } }])
})
