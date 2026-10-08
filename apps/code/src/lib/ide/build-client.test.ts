import { afterEach, expect, it } from 'bun:test'
import { buildInBrowser, releaseBrowserCompiler } from './build-client'
import type { BrowserBuildInput } from './browser-build'

const NativeWorker = globalThis.Worker
class CompilerWorker {
  static current: CompilerWorker
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: unknown
  requests: Array<BrowserBuildInput> = []
  terminated = false
  constructor() {
    CompilerWorker.current = this
  }
  postMessage(input: BrowserBuildInput) {
    this.requests.push(input)
  }
  terminate() {
    this.terminated = true
  }
  result() {
    this.onmessage?.({
      data: {
        kind: 'result',
        result: {
          commitSha: this.requests.at(-1)!.commitSha,
          exitCode: 0,
          output: '',
          artifacts: [],
        },
      },
    })
  }
}

afterEach(() => {
  releaseBrowserCompiler()
  globalThis.Worker = NativeWorker
})
const input = (): BrowserBuildInput => ({
  workspaceId: 'test',
  files: { 'src/a.cpp': 'original' },
  template: 'vexcode',
  commitSha: 'test',
})

it('serializes builds and captures queued snapshots at submission', async () => {
  globalThis.Worker = CompilerWorker as unknown as typeof Worker
  const first = buildInBrowser(input(), () => {})
  const next = input()
  const second = buildInBrowser(next, () => {})
  next.files['src/a.cpp'] = 'edited after submission'
  await Bun.sleep(0)
  const worker = CompilerWorker.current
  expect(worker.requests).toHaveLength(1)
  worker.result()
  await first
  await Bun.sleep(0)
  expect(worker.requests).toHaveLength(2)
  expect(worker.requests[1].files['src/a.cpp']).toBe('original')
  worker.result()
  await second
})

it('disposal rejects both active and queued builds and flushes pending logs', async () => {
  globalThis.Worker = CompilerWorker as unknown as typeof Worker
  let output = ''
  const first = buildInBrowser(input(), (text) => {
    output += text
  })
  const second = buildInBrowser(input(), () => {})
  const settled = Promise.allSettled([first, second])
  await Bun.sleep(0)
  const worker = CompilerWorker.current
  worker.onmessage?.({ data: { kind: 'output', text: 'final diagnostic' } })
  releaseBrowserCompiler()
  const results = await settled
  expect(results.map((result) => result.status)).toEqual([
    'rejected',
    'rejected',
  ])
  expect(output).toBe('final diagnostic')
  expect(worker.terminated).toBe(true)
})

it('acknowledges owned cold bytes and materializes references after consumers mutate old results', async () => {
  const { buildCacheKey } = await import('./build-cache')
  globalThis.Worker = CompilerWorker as unknown as typeof Worker
  const bytes = new Uint8Array([1, 2, 3])
  const digest = await buildCacheKey([bytes])
  const first = buildInBrowser(input(), () => {})
  await Bun.sleep(0)
  const worker = CompilerWorker.current
  worker.onmessage?.({
    data: {
      kind: 'result',
      result: {
        commitSha: 'test',
        exitCode: 0,
        output: '',
        artifacts: [{ path: 'bin/cold.package.bin', bytes, digest, size: 3 }],
      },
    },
  })
  const firstResult = await first
  firstResult.artifacts[0].bytes[0] = 99
  const second = buildInBrowser(input(), () => {})
  await Bun.sleep(0)
  expect(worker.requests.at(-1)!.knownArtifacts).toEqual([digest])
  worker.onmessage?.({
    data: {
      kind: 'result',
      result: {
        commitSha: 'test',
        exitCode: 0,
        output: '',
        artifacts: [{ path: 'bin/cold.package.bin', digest, size: 3 }],
      },
    },
  })
  expect([...(await second).artifacts[0].bytes]).toEqual([1, 2, 3])
})
