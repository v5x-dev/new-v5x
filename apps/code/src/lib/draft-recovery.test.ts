import { expect, test } from 'bun:test'
import { importDraftRecovery } from './draft-recovery'

test('recovery import preserves the downloaded text and file paths', () => {
  expect(
    importDraftRecovery(
      JSON.stringify({
        version: 1,
        files: { 'src/main.cpp': '// λ\r\n', makefile: 'all:\n' },
      }),
    ),
  ).toEqual([
    { path: 'src/main.cpp', contents: '// λ\r\n' },
    { path: 'makefile', contents: 'all:\n' },
  ])
})

test('invalid recovery data cannot bypass source import constraints', () => {
  for (const value of [
    null,
    [],
    { version: 2, files: {} },
    { version: 1, files: [] },
    { version: 1, files: {} },
    { version: 1, files: { '../secret': 'text' } },
    { version: 1, files: { 'main.cpp': 42 } },
    { version: 1, files: { a: 'text', 'a/b': 'text' } },
    { version: 1, files: { 'main.cpp': '\0' } },
  ]) {
    expect(() => importDraftRecovery(JSON.stringify(value))).toThrow()
  }
})
