import { describe, expect, it } from 'vitest'
import { parseBuildProblems } from './build-problems'

describe('parseBuildProblems', () => {
  it('parses errors and warnings with zero-based positions and workspace paths', () => {
    const problems = parseBuildProblems(
      '/workspace/src/main.cpp:12:3: error: unknown name: motor\r\n./include/main.h:2:1: warning: unused declaration',
    )
    expect(
      problems.map(({ path, diagnostic }) => [
        path,
        diagnostic.severity,
        diagnostic.range.start,
        diagnostic.message,
      ]),
    ).toEqual([
      ['src/main.cpp', 1, { line: 11, character: 2 }, 'unknown name: motor'],
      ['include/main.h', 2, { line: 1, character: 0 }, 'unused declaration'],
    ])
  })

  it('handles colored fatal errors and ignores non-diagnostics and invalid positions', () => {
    expect(
      parseBuildProblems(
        'compiling\nfoo.cpp:0:1: error: invalid\n\x1b[31mfoo.cpp:1:2: fatal error: missing header\x1b[0m',
      ),
    ).toMatchObject([
      {
        path: 'foo.cpp',
        diagnostic: { severity: 1, message: 'missing header' },
      },
    ])
  })

  it('preserves Windows path colons', () => {
    expect(
      parseBuildProblems('C:\\src\\main.cpp:2:4: error: bad')[0].path,
    ).toBe('C:\\src\\main.cpp')
  })
})
