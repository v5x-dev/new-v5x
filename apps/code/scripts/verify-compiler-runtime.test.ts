import { expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'

// Exercise the actual patched runtime, with private filesystem classes exposed only to this test.
const source = await readFile(
  new URL('../node_modules/microbit-clang-wasm/gen/bundle.js', import.meta.url),
  'utf8',
)
const runtime = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      source +
        '\nexport { File, WriteStream, Descriptor, resources, moduleCache };\n',
    ).toString('base64')
)

it('grows streamed files with bounded allocations and preserves seeks, truncation, and host bytes', () => {
  const host = new Uint8Array([1, 2, 3, 4])
  const file = new runtime.File(host)
  const stream = new runtime.WriteStream(file, 0n)
  stream.write(new Uint8Array([9]))
  expect([...host]).toEqual([1, 2, 3, 4])
  expect([...file.data]).toEqual([9, 2, 3, 4])
  const descriptor = new runtime.Descriptor(file)
  descriptor.setSize(1n)
  descriptor.write(new Uint8Array([8]), 4n)
  expect([...file.data]).toEqual([9, 0, 0, 0, 8])
  descriptor.write(new Uint8Array([7]), 1n)
  expect([...file.data]).toEqual([9, 7, 0, 0, 8])
  const append = new runtime.WriteStream(file, 5n)
  const buffers = new Set<ArrayBuffer>()
  for (let index = 0; index < 1024; index++) {
    append.write(new Uint8Array(4096).fill(index % 256))
    buffers.add(file.data.buffer)
  }
  expect(buffers.size).toBeLessThan(14)
  expect(file.size).toBe(5 + 1024 * 4096)
  expect(file.data[5 + 4096 * 511]).toBe(255)
  descriptor.setSize(2n)
  descriptor.setSize(6n)
  expect([...file.data]).toEqual([9, 7, 0, 0, 0, 0])
  file.data = new Uint8Array([11])
  descriptor.write(new Uint8Array([12]), 2n)
  expect([...file.data]).toEqual([11, 0, 12])
})

it('keys compiler modules by asset identity, reuses both variants, bounds retention and retries failed loads', async () => {
  const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
  const loads: string[] = []
  const loader = (identity: string, broken = false) => {
    runtime.setAssetLoader((name: string) => {
      loads.push(identity + ':' + name)
      if (broken) throw new Error('asset unavailable')
      return wasm
    }, identity)
  }
  loader('original')
  const original = await runtime.resources.modules()
  loader('optimized')
  const optimized = await runtime.resources.modules()
  expect(optimized['llvm.core.wasm']).not.toBe(original['llvm.core.wasm'])
  loader('original')
  expect(await runtime.resources.modules()).toBe(original)
  expect(loads).toHaveLength(8)
  loader('failed', true)
  await expect(runtime.resources.modules()).rejects.toThrow('asset unavailable')
  expect(runtime.moduleCache.size).toBeLessThanOrEqual(2)
  loader('failed')
  await expect(runtime.resources.modules()).resolves.toBeDefined()
  expect(runtime.moduleCache.size).toBeLessThanOrEqual(2)
})
