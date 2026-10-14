import { expect, test } from 'bun:test'
import { compilationServerUrl } from './remote-build'

const token = '0123456789abcdef0123456789abcdef'

test('accepts a Cloudflare base URL and a separate token', () => {
  expect(compilationServerUrl('https://example.trycloudflare.com', token)).toBe(
    `wss://example.trycloudflare.com/compile?token=${token}`,
  )
  expect(compilationServerUrl('wss://example.trycloudflare.com/', token)).toBe(
    `wss://example.trycloudflare.com/compile?token=${token}`,
  )
})

test('preserves full server URLs, their embedded tokens, and proxy paths', () => {
  expect(
    compilationServerUrl(`ws://localhost:8787/compile?token=${token}`),
  ).toBe(`ws://localhost:8787/compile?token=${token}`)
  expect(
    compilationServerUrl(
      `https://example.com/proxy/compile?token=${token}`,
      'old-token-value-1234',
    ),
  ).toBe(`wss://example.com/proxy/compile?token=${token}`)
  expect(compilationServerUrl(' http://localhost:8787 ', ` ${token} `)).toBe(
    `ws://localhost:8787/compile?token=${token}`,
  )
})

test('explains missing credentials before attempting a connection', () => {
  expect(() => compilationServerUrl('wss://example.trycloudflare.com')).toThrow(
    'access token printed',
  )
  expect(() => compilationServerUrl('invalid', token)).toThrow(
    'server or tunnel URL',
  )
  expect(() => compilationServerUrl('file:///tmp/server', token)).toThrow(
    'server URL',
  )
  expect(() =>
    compilationServerUrl('wss://user:password@example.com', token),
  ).toThrow('server URL')
})
