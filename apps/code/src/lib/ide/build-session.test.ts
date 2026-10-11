import { describe, expect, it } from 'bun:test'
import { BrowserBuildSession, validDependencyRecord } from './build-session'
import type { Session } from 'microbit-clang-wasm'

function filesystem() {
  const files = new Map<string, Uint8Array>()
  const writes: Array<string> = []
  let reads = 0
  const session = {
    async writeFile(path: string, bytes: string | Uint8Array) {
      writes.push(path)
      files.set(
        path,
        typeof bytes === 'string'
          ? new TextEncoder().encode(bytes)
          : bytes.slice(),
      )
    },
    async readFile(path: string) {
      reads++
      return files.get(path)?.slice() ?? null
    },
    async remove(path: string) {
      for (const key of files.keys())
        if (key === path || key.startsWith(path + '/')) files.delete(key)
    },
  } as Session
  return { session, files, writes, reads: () => reads }
}

describe('retained build session', () => {
  it('retains aggregate identities and invalidates source edits, header edits, deletions, and time macros', async () => {
    const fs = filesystem()
    const state = new BrowserBuildSession(fs.session)
    const files = { 'src/a.cpp': 'int a;', 'include/a.h': 'int b;' }
    await state.synchronize(files)
    const paths = ['/workspace/src/a.cpp', '/workspace/include/a.h']
    const initial = state.dependencyKey(paths)
    const digest = await initial
    expect(state.dependencyKey([...paths])).toBe(initial)
    await state.synchronize({ ...files, 'src/unrelated.cpp': 'int c;' })
    expect(state.dependencyKey(paths)).toBe(initial)
    await state.synchronize({ ...files, 'src/a.cpp': 'int a = 1;' })
    expect(await state.dependencyKey(paths)).not.toBe(digest)
    await state.synchronize({ ...files, 'include/a.h': 'int b = 2;' })
    expect(await state.dependencyKey(paths)).not.toBe(digest)
    await state.synchronize({ 'src/a.cpp': 'int a;' })
    expect(await state.dependencyKey(paths)).toBeUndefined()
    await state.synchronize({ ...files, 'include/a.h': '__TIME__' })
    expect(await state.dependencyKey(paths)).toBeUndefined()
    await state.synchronize(files)
    expect(await state.dependencyKey(paths)).toBe(digest)
    await state.synchronizeSdkPrefix('prefix')
    const prefix = state.dependencyKey(['/sdk/pch/prefix.hpp'])
    await prefix
    await state.synchronizeSdkPrefix('prefix')
    expect(state.dependencyKey(['/sdk/pch/prefix.hpp'])).toBe(prefix)
    await state.synchronizeSdkPrefix('changed prefix')
    expect(await state.dependencyKey(['/sdk/pch/prefix.hpp'])).not.toBe(
      await prefix,
    )
  })

  it('writes changes only, restores overlays, removes obsolete outputs and memoizes dependencies', async () => {
    const fs = filesystem()
    const state = new BrowserBuildSession(fs.session)
    await state.mount([
      ['/workspace/include/a.h', 'base'],
      ['/workspace/include/a.h', 'overlay'],
    ])
    await state.synchronize({ 'include/a.h': 'project', 'src/a.cpp': 'source' })
    const digest = await state.dependencyDigest('/workspace/include/a.h')
    await state.dependencyDigest('/workspace/include/a.h')
    expect(fs.reads()).toBe(1)
    fs.writes.length = 0
    expect(
      await state.synchronize({
        'include/a.h': 'project',
        'src/a.cpp': 'source',
      }),
    ).toEqual({ written: 0, removed: 0 })
    expect(fs.writes).toEqual([])
    await fs.session.writeFile('/workspace/.browser-build/stale.o', 'old')
    expect(await state.synchronize({ 'src/a.cpp': 'new' })).toEqual({
      written: 1,
      removed: 1,
    })
    expect(
      new TextDecoder().decode(fs.files.get('/workspace/include/a.h')),
    ).toBe('overlay')
    expect(fs.files.has('/workspace/.browser-build/stale.o')).toBe(false)
    expect(await state.dependencyDigest('/workspace/include/a.h')).not.toBe(
      digest,
    )
  })

  it('does not cache time macros and protects include shadowing and uncertain includes', async () => {
    const fs = filesystem()
    const state = new BrowserBuildSession(fs.session)
    await state.synchronize({ 'src/a.cpp': '__TIME__' })
    expect(await state.dependencyDigest('/workspace/src/a.cpp')).toBeUndefined()
    const files = { 'src/a.cpp': '#include "a.h"' }
    expect(state.inventory({ ...files, 'README.md': 'docs' })).toEqual(
      state.inventory(files),
    )
    expect(state.inventory({ ...files, 'src/a.h': '' })).not.toEqual(
      state.inventory(files),
    )
    expect(
      state.inventory({
        ...files,
        'src/check.cpp': '#if __has_include("README.md")',
        'README.md': '',
      }),
    ).toContain('README.md')
    expect(
      state.inventory({ 'src/a.cpp': '#include HEADER', 'README.md': '' }),
    ).toContain('README.md')
  })

  it('rejects an invalid snapshot before making partial changes', async () => {
    const fs = filesystem()
    const state = new BrowserBuildSession(fs.session)
    await expect(
      state.synchronize({ 'src/a.cpp': '', '../bad': '' }),
    ).rejects.toThrow('Invalid')
    expect(fs.writes).toEqual([])
  })

  it('bounds and validates dependency metadata before filesystem access', () => {
    const digest = 'a'.repeat(64)
    expect(
      validDependencyRecord({ paths: ['/workspace/include/a.h'], digest }),
    ).toBe(true)
    for (const paths of [[], ['/workspace/../secret'], ['/private/file'], [42]])
      expect(validDependencyRecord({ paths, digest })).toBe(false)
    expect(
      validDependencyRecord({ paths: ['/workspace/a.h'], digest: 'bad' }),
    ).toBe(false)
  })
})

it('ordinary source additions preserve inventory, while literal source includes and has-include probes invalidate it', async () => {
  const fs = filesystem()
  const state = new BrowserBuildSession(fs.session)
  const files = { 'src/a.cpp': '#include "a.h"', 'include/a.h': '' }
  expect(state.inventory({ ...files, 'src/b.cpp': 'int b;' })).toEqual(
    state.inventory(files),
  )
  expect(
    state.inventory({
      ...files,
      'src/a.cpp': '#include "b.cpp"',
      'src/b.cpp': '',
    }),
  ).toContain('src/b.cpp')
  expect(
    state.inventory({
      ...files,
      'src/a.cpp': '#if __has_include("b.cpp")',
      'src/b.cpp': '',
    }),
  ).toContain('src/b.cpp')
})
