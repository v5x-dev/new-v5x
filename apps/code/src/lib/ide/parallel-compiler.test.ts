import { expect, test } from 'bun:test'
import { experimentalSourceCompiler } from './parallel-compiler'

test('parallel worker failure rejects pending and future jobs and disposal is safe', async () => {
  const original = globalThis.Worker
  let instance: FakeWorker
  class FakeWorker {
    onerror?: () => void
    onmessage?: (event: { data: unknown }) => void
    terminated = false
    constructor() {
      instance = this
    }
    postMessage() {}
    terminate() {
      this.terminated = true
    }
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  try {
    const compiler = experimentalSourceCompiler(
      { template: 'pros', files: {}, commitSha: 'test' },
      { files: {} },
      { version: 1, gccVersion: 'test', templates: {}, bundles: {} },
    )
    const pending = compiler.compile(['clang'], '/workspace/test.o')
    const rejection = pending.catch((error: Error) => error)
    instance!.onerror!()
    expect(((await rejection) as Error).message).toContain('stopped')
    await expect(
      compiler.compile(['clang'], '/workspace/test.o'),
    ).rejects.toThrow('stopped')
    compiler.dispose()
    expect(instance!.terminated).toBe(true)
  } finally {
    globalThis.Worker = original
  }
})
