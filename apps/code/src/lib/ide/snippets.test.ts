import { describe, expect, test } from 'bun:test'
import { expandSnippet, offsetPosition, remapSnippetStops } from './snippets'

describe('completion snippets', () => {
  test('expands variables and keeps final cursor after numbered placeholders', () => {
    const result = expandSnippet(
      '${TM_FILENAME_BASE}(${1:value}, ${2:other})$0',
      'src/main.cpp',
    )

    expect(result.text).toBe('main(value, other)')
    expect(result.stops.map((stop) => stop.index)).toEqual([1, 2, 0])

    expect(result.text.slice(result.stops[0].start, result.stops[0].end)).toBe(
      'value',
    )
  })

  test('tracks placeholder ranges after replacement and UTF-16 positions', () => {
    expect(
      remapSnippetStops(
        [
          { index: 1, start: 2, end: 5 },
          { index: 0, start: 7, end: 7 },
        ],
        [{ start: 2, end: 5, text: 'longer' }],
      ),
    ).toEqual([
      { index: 1, start: 2, end: 8 },
      { index: 0, start: 10, end: 10 },
    ])

    expect(offsetPosition('a\n😀x', 5)).toEqual({ line: 1, character: 3 })
  })
})
