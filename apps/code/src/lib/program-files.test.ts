import { describe, expect, test } from 'bun:test'
import { parseProgramFilePaths } from './program-files'

describe('parseProgramFilePaths', () => {
  test('accepts the current backend response', () => {
    expect(
      parseProgramFilePaths({ paths: ['src/main.cpp'], commitSha: 'abc' }),
    ).toEqual(['src/main.cpp'])
  })

  test('accepts the legacy backend response', () => {
    expect(parseProgramFilePaths(['src/main.cpp'])).toEqual(['src/main.cpp'])
  })

  test('accepts an empty file list in both formats', () => {
    expect(parseProgramFilePaths([])).toEqual([])
    expect(parseProgramFilePaths({ paths: [] })).toEqual([])
  })

  test('rejects malformed responses before they enter component state', () => {
    for (const result of [
      undefined,
      null,
      {},
      { paths: null },
      'file',
      [123],
    ]) {
      expect(() => parseProgramFilePaths(result)).toThrow('invalid file list')
    }
  })
})
