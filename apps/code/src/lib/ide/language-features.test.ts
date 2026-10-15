import { describe, expect, test } from 'bun:test'
import {
  completionEdits,
  definitionTarget,
  normalizeCompletions,
  shouldTriggerCompletion,
} from './language-features'

describe('shouldTriggerCompletion', () => {
  test('triggers after identifiers and member or scope access', () => {
    for (const text of ['ab', 'motor.', 'robot->', 'vex::'])
      expect(shouldTriggerCompletion(text, text.length)).toBe(true)
  })

  test('ignores single letters, spaces and numbers', () => {
    for (const text of ['a', 'motor ', '1', '(', ''])
      expect(shouldTriggerCompletion(text, text.length)).toBe(false)
  })
})

describe('normalizeCompletions', () => {
  test('sorts, limits and drops documentation', () => {
    const items = Array.from({ length: 30 }, (_, index) => ({
      label: `item${String(index).padStart(2, '0')}`,
      sortText: String(29 - index).padStart(2, '0'),
      documentation: 'hidden',
    }))

    const result = normalizeCompletions({ isIncomplete: false, items })
    expect(result).toHaveLength(20)
    expect(result[0]?.label).toBe('item29')
    expect(result.every((item) => !('documentation' in item))).toBe(true)
  })

  test('accepts arrays and empty results', () => {
    expect(normalizeCompletions([{ label: 'b' }, { label: 'a' }])).toEqual([
      { label: 'a' },
      { label: 'b' },
    ])
    expect(normalizeCompletions(null)).toEqual([])
  })
})

describe('completionEdits', () => {
  const doc = { path: 'src/main.cpp', contents: 'int x = mo\n' }
  const position = { line: 0, character: 10 }

  test('inserts plain text at the requested position', () => {
    const { edits, stops } = completionEdits({ label: 'motor' }, doc, position)
    expect(edits).toEqual([
      { range: { start: position, end: position }, newText: 'motor' },
    ])
    expect(stops).toEqual([])
  })

  test('expands snippets and offsets their stops past earlier edits', () => {
    const { edits, stops } = completionEdits(
      {
        label: 'spin',
        insertTextFormat: 2,
        textEdit: {
          range: { start: { line: 0, character: 8 }, end: position },
          newText: 'spin(${1:speed})$0',
        },
        additionalTextEdits: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: '#include "v5.h"\n',
          },
        ],
      },
      doc,
      position,
    )

    expect(edits[0]?.newText).toBe('spin(speed)')
    // 16 inserted characters precede the replaced range at offset 8.
    expect(stops).toContainEqual({ index: 1, start: 29, end: 34 })
  })
})

describe('definitionTarget', () => {
  const range = {
    start: { line: 3, character: 2 },
    end: { line: 3, character: 5 },
  }

  test('maps workspace and SDK locations', () => {
    expect(
      definitionTarget({ uri: 'file:///workspace/src/main.cpp', range }),
    ).toEqual({
      kind: 'workspace',
      path: 'src/main.cpp',
      position: range.start,
    })

    expect(
      definitionTarget([{ uri: 'file:///sdk/include/v5.h', range }]),
    ).toEqual({ kind: 'sdk', path: '/sdk/include/v5.h', position: range.start })
  })

  test('uses the target selection of location links', () => {
    expect(
      definitionTarget([
        {
          targetUri: 'file:///toolchain/include/math.h',
          targetRange: range,
          targetSelectionRange: {
            start: { line: 9, character: 0 },
            end: { line: 9, character: 4 },
          },
        },
      ]),
    ).toEqual({
      kind: 'sdk',
      path: '/toolchain/include/math.h',
      position: { line: 9, character: 0 },
    })
  })

  test('rejects other locations and empty results', () => {
    expect(definitionTarget({ uri: 'file:///etc/passwd', range })).toBeNull()
    expect(definitionTarget([])).toBeNull()
    expect(definitionTarget(null)).toBeNull()
  })
})
