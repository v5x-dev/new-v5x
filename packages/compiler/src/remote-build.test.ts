import { expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import {
  buildOnServer,
  compilationProtocol,
  compilationServerUrl,
  maximumArtifactBytes,
} from './remote-build'
import type { BrowserBuildInput } from './browser-build'

const token = '0123456789abcdef0123456789abcdef'
const input: BrowserBuildInput = {
  files: { 'src/main.cpp': 'int main() { return 0; }' },
  template: 'vexcode',
  commitSha: 'test-commit',
}

type TestSocket = ServerWebSocket<{}>
type FakeMessageHandler = (
  socket: TestSocket,
  message: Record<string, unknown>,
) => void

function startFakeServer(onMessage: FakeMessageHandler) {
  return Bun.serve<{}>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (
        server.upgrade(request, {
          data: {},
          headers: { 'Sec-WebSocket-Protocol': compilationProtocol },
        })
      )
        return
      return new Response('Expected WebSocket', { status: 400 })
    },
    websocket: {
      open(socket) {
        socket.send(
          JSON.stringify({ type: 'ready', protocol: compilationProtocol }),
        )
      },
      message(socket, data) {
        if (typeof data !== 'string') return
        const message = JSON.parse(data)
        onMessage(socket, message)
      },
    },
  })
}

function endpoint(server: ReturnType<typeof startFakeServer>) {
  return `ws://127.0.0.1:${server.port}/compile?token=${token}`
}

function artifactFrame(index: number, offset: number, bytes: Uint8Array) {
  const frame = new Uint8Array(8 + bytes.byteLength)
  const header = new DataView(frame.buffer)
  header.setUint32(0, index, true)
  header.setUint32(4, offset, true)
  frame.set(bytes, 8)
  return frame
}

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

test('negotiates binary-v1 and copies frames into final artifact arrays', async () => {
  const first = Uint8Array.of(3, 7, 11, 19, 23)
  const third = Uint8Array.of(5, 13, 17, 29)
  const server = startFakeServer((socket, message) => {
    if (message.type === 'build') {
      expect(message.artifactEncoding).toBe('binary-v1')
      socket.send(
        JSON.stringify({
          type: 'result-start',
          result: { commitSha: input.commitSha, exitCode: 0, output: 'ok' },
          artifacts: [
            { path: 'bin/robot', byteLength: first.byteLength },
            { path: 'empty.bin', byteLength: 0 },
            { path: 'lib/runtime.a', byteLength: third.byteLength },
          ],
        }),
      )
      socket.send(artifactFrame(0, 0, first))
    } else if (message.type === 'artifact-ack' && message.index === 0) {
      expect(message.offset).toBe(first.byteLength)
      socket.send(artifactFrame(2, 0, third))
    } else if (message.type === 'artifact-ack' && message.index === 2) {
      expect(message.offset).toBe(third.byteLength)
      socket.send(JSON.stringify({ type: 'result-end' }))
    }
  })

  try {
    const result = await buildOnServer(endpoint(server), input, () => {})
    expect(result.exitCode).toBe(0)
    expect(result.output).toBe('ok')
    expect(result.artifacts.map(({ path }) => path)).toEqual([
      'bin/robot',
      'empty.bin',
      'lib/runtime.a',
    ])
    expect(Array.from(result.artifacts[0]!.bytes)).toEqual(Array.from(first))
    expect(result.artifacts[1]!.bytes.byteLength).toBe(0)
    expect(Array.from(result.artifacts[2]!.bytes)).toEqual(Array.from(third))
  } finally {
    server.stop(true)
  }
})

test('waits for result-end after the last artifact ACK', async () => {
  const artifact = Uint8Array.of(8, 16, 32)
  let acknowledgeReceived!: () => void
  let sendResultEnd!: () => void
  const acknowledged = new Promise<void>((resolve) => {
    acknowledgeReceived = resolve
  })
  const server = startFakeServer((socket, message) => {
    if (message.type === 'build') {
      socket.send(
        JSON.stringify({
          type: 'result-start',
          result: { commitSha: input.commitSha, exitCode: 0, output: '' },
          artifacts: [{ path: 'bin/robot', byteLength: artifact.byteLength }],
        }),
      )
      socket.send(artifactFrame(0, 0, artifact))
    } else if (message.type === 'artifact-ack') {
      acknowledgeReceived()
      sendResultEnd = () => socket.send(JSON.stringify({ type: 'result-end' }))
    }
  })

  try {
    let settled = false
    const resultPromise = buildOnServer(endpoint(server), input, () => {})
    void resultPromise.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )

    await acknowledged
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)
    sendResultEnd()

    const result = await resultPromise
    expect(result.artifacts[0]!.bytes).toEqual(artifact)
  } finally {
    server.stop(true)
  }
})

test('decodes a large legacy base64 result into an owned byte array', async () => {
  const bytes = new Uint8Array(2_400_000)
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = (index * 31 + 17) & 0xff
  const base64 = Buffer.from(bytes).toString('base64')
  const server = startFakeServer((socket, request) => {
    if (request.type !== 'build') return
    expect(request.artifactEncoding).toBe('binary-v1')
    socket.send(
      JSON.stringify({
        type: 'result',
        result: {
          commitSha: input.commitSha,
          exitCode: 0,
          output: 'legacy server',
          artifacts: [{ path: 'bin/robot', base64 }],
        },
      }),
    )
  })

  try {
    const result = await buildOnServer(endpoint(server), input, () => {})
    expect(result.artifacts).toHaveLength(1)
    expect(result.artifacts[0]!.bytes).toHaveLength(bytes.length)
    expect(result.artifacts[0]!.bytes).toEqual(bytes)
    expect(result.artifacts[0]!.bytes[0]).toBe(17)
    expect(result.artifacts[0]!.bytes[1]).toBe(48)
    expect(result.artifacts[0]!.bytes[1_200_123]).toBe(bytes[1_200_123])
    expect(result.artifacts[0]!.bytes.at(-1)).toBe(bytes.at(-1))
  } finally {
    server.stop(true)
  }
})

test('rejects malformed and out-of-order binary frames', async () => {
  const server = startFakeServer((socket, message) => {
    if (message.type !== 'build') return
    socket.send(
      JSON.stringify({
        type: 'result-start',
        result: { commitSha: input.commitSha, exitCode: 0, output: '' },
        artifacts: [{ path: 'bin/robot', byteLength: 4 }],
      }),
    )
    socket.send(artifactFrame(0, 1, Uint8Array.of(1, 2, 3)))
  })

  try {
    await expect(
      buildOnServer(endpoint(server), input, () => {}),
    ).rejects.toThrow('out-of-order')
  } finally {
    server.stop(true)
  }
})

test('rejects unsafe artifact metadata before receiving any frames', async () => {
  const server = startFakeServer((socket, message) => {
    if (message.type !== 'build') return
    socket.send(
      JSON.stringify({
        type: 'result-start',
        result: { commitSha: input.commitSha, exitCode: 0, output: '' },
        artifacts: [{ path: '../robot', byteLength: 1 }],
      }),
    )
  })

  try {
    await expect(
      buildOnServer(endpoint(server), input, () => {}),
    ).rejects.toThrow('Invalid remote build artifact')
  } finally {
    server.stop(true)
  }
})

test('rejects artifact metadata exceeding the 64 MB limit', async () => {
  const server = startFakeServer((socket, message) => {
    if (message.type !== 'build') return
    socket.send(
      JSON.stringify({
        type: 'result-start',
        result: { commitSha: input.commitSha, exitCode: 0, output: '' },
        artifacts: [
          { path: 'bin/robot', byteLength: maximumArtifactBytes + 1 },
        ],
      }),
    )
  })

  try {
    await expect(
      buildOnServer(endpoint(server), input, () => {}),
    ).rejects.toThrow('exceed 64 MB')
  } finally {
    server.stop(true)
  }
})

test('rejects result-end after a truncated artifact stream', async () => {
  const server = startFakeServer((socket, message) => {
    if (message.type !== 'build') return
    socket.send(
      JSON.stringify({
        type: 'result-start',
        result: { commitSha: input.commitSha, exitCode: 0, output: '' },
        artifacts: [{ path: 'bin/robot', byteLength: 4 }],
      }),
    )
    socket.send(artifactFrame(0, 0, Uint8Array.of(1, 2)))
    socket.send(JSON.stringify({ type: 'result-end' }))
  })

  try {
    await expect(
      buildOnServer(endpoint(server), input, () => {}),
    ).rejects.toThrow('truncated')
  } finally {
    server.stop(true)
  }
})

test('cancels a remote build after it has started', async () => {
  const controller = new AbortController()
  const server = startFakeServer((_, message) => {
    if (message.type === 'build') setTimeout(() => controller.abort(), 5)
  })

  try {
    await expect(
      buildOnServer(endpoint(server), input, () => {}, controller.signal),
    ).rejects.toThrow('Build cancelled')
  } finally {
    server.stop(true)
  }
})
