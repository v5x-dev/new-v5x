import { expect, test } from 'bun:test'
import { zipSync } from 'fflate'
import { exportSourceZip, importSourceZip } from './source-zip'
import { validateSourceFiles } from './source-files'

const encode = (files: Record<string, string>) =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, text]) => [
        path,
        new TextEncoder().encode(text),
      ]),
    ),
  )

test('source ZIPs round-trip Unicode, CRLF, hidden files and project folders', () => {
  const files = [
    { path: 'src/main.cpp', contents: '// robot 🦾\r\n' },
    { path: '.gitignore', contents: 'build/' },
  ]
  expect(
    importSourceZip(exportSourceZip(files)).sort((a, b) =>
      a.path.localeCompare(b.path),
    ),
  ).toEqual([...files].sort((a, b) => a.path.localeCompare(b.path)))
  expect(
    importSourceZip(
      encode({
        'robot/src/main.cpp': 'int main() {}',
        'robot/Makefile': 'all:',
      }),
      true,
    ),
  ).toEqual([
    { path: 'src/main.cpp', contents: 'int main() {}' },
    { path: 'Makefile', contents: 'all:' },
  ])
})

test('source imports reject unsafe paths, ambiguous trees, binary content and expansion bombs', () => {
  for (const path of [
    '../main.cpp',
    '/main.cpp',
    'src/../../main.cpp',
    '.git/config',
    'C:/main.cpp',
    'src\\main.cpp',
  ]) {
    expect(() => importSourceZip(encode({ [path]: 'x' }))).toThrow()
  }
  expect(() => importSourceZip(encode({ 'main.cpp': '\0binary' }))).toThrow(
    'Binary',
  )
  expect(() =>
    importSourceZip(encode({ 'main.cpp': 'x'.repeat(8 * 1024 * 1024 + 1) })),
  ).toThrow('8 MiB')
  expect(() => importSourceZip(new Uint8Array([1, 2, 3]))).toThrow()
  expect(() =>
    validateSourceFiles([
      { path: 'src', contents: '' },
      { path: 'src/main.cpp', contents: '' },
    ]),
  ).toThrow('both a file')
  expect(() =>
    validateSourceFiles([
      { path: 'main.cpp', contents: '' },
      { path: 'main.cpp', contents: '' },
    ]),
  ).toThrow('Duplicate')
})

test('single-folder exports keep their paths and truncated archives fail', () => {
  const bytes = exportSourceZip([
    { path: 'src/main.cpp', contents: 'int main() {}' },
  ])
  expect(importSourceZip(bytes)[0].path).toBe('src/main.cpp')
  expect(() => importSourceZip(bytes.subarray(0, bytes.length - 10))).toThrow()
  const corrupt = bytes.slice()
  corrupt[corrupt.length - 22 - 46 - 'src/main.cpp'.length + 16] ^= 1
  expect(() => importSourceZip(corrupt)).toThrow('checksum')
})

test('PROS source archives omit generated outputs and SDK binaries without decompressing them', () => {
  const bytes = encode({
    'robot/src/main.cpp': '#include "main.h"',
    'robot/Makefile': 'all:',
    'robot/firmware/kernel.a': '\0binary',
    'robot/bin/hot.bin': '\0generated',
  })
  expect(importSourceZip(bytes, true).map((file) => file.path)).toEqual([
    'src/main.cpp',
    'Makefile',
  ])
})

test('source ZIPs reject symlink metadata', () => {
  const bytes = exportSourceZip([{ path: 'main.cpp', contents: 'target' }])
  const view = new DataView(bytes.buffer)
  const central = view.getUint32(bytes.length - 22 + 16, true)
  view.setUint32(central + 38, 0xa1ff0000, true)
  expect(() => importSourceZip(bytes)).toThrow('symlinks')
})
