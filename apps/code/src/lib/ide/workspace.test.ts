import { describe, expect, test } from 'bun:test'
import {
  applyTextEdits,
  applyWorkspaceEdit,
  fileUri,
  isDirty,
  positionOffset,
  recoverDocuments,
  searchWorkspace,
  uriPath,
} from './workspace'
import { compileCommands } from './compile-commands'
import { symbolFoldingRanges } from './folding'
import { decodeSemanticTokens } from './semantic-tokens'
import type { Documents } from './workspace'

const doc = (path: string, contents: string) => ({
  path,
  contents,
  baseline: contents,
  version: 7,
})

describe('workspace correctness', () => {
  test('LSP positions and edits preserve UTF-16 and CRLF', () => {
    const source = 'a😀b\r\nnext\r\n'
    expect(positionOffset(source, { line: 0, character: 3 })).toBe(3)

    expect(
      applyTextEdits(source, [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 3 },
          },
          newText: 'robot',
        },
      ]),
    ).toBe('arobotb\r\nnext\r\n')

    expect(() => positionOffset(source, { line: 0, character: 5 })).toThrow()
  })

  test('rejects overlap before changing text', () => {
    expect(() =>
      applyTextEdits('abcd', [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 3 },
          },
          newText: 'x',
        },
        {
          range: {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 4 },
          },
          newText: 'y',
        },
      ]),
    ).toThrow('Overlapping')
  })

  test('a stale second document prevents the entire multi-file edit', () => {
    const documents: Documents = {
      'a.cpp': doc('a.cpp', 'speed'),
      'b.cpp': doc('b.cpp', 'speed'),
    }

    const edits = [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
        newText: 'velocity',
      },
    ]

    expect(() =>
      applyWorkspaceEdit(documents, {
        documentChanges: [
          { textDocument: { uri: fileUri('a.cpp'), version: 7 }, edits },
          { textDocument: { uri: fileUri('b.cpp'), version: 6 }, edits },
        ],
      }),
    ).toThrow('changed while refactoring')

    expect(documents['a.cpp']?.contents).toBe('speed')
    expect(documents['b.cpp']?.version).toBe(7)
  })

  test('rename records an addition and deletion with correct commit baselines', () => {
    const result = applyWorkspaceEdit(
      { 'a.cpp': doc('a.cpp', 'int x;') },
      {
        documentChanges: [
          {
            kind: 'rename',
            oldUri: fileUri('a.cpp'),
            newUri: fileUri('src/b.cpp'),
          },
        ],
      },
    )

    expect(result['a.cpp']?.deleted).toBe(true)
    expect(result['src/b.cpp']?.baseline).toBeNull()
    expect(result['src/b.cpp']?.contents).toBe('int x;')
    expect(isDirty(result['a.cpp']!)).toBe(true)
    expect(isDirty(result['src/b.cpp']!)).toBe(true)
  })

  test('workspace URIs round trip spaces and reject traversal and foreign files', () => {
    expect(uriPath(fileUri('src/hello world.cpp'))).toBe('src/hello world.cpp')
    expect(() => uriPath('file:///sdk/vex.h')).toThrow()
    expect(() => fileUri('../a.cpp')).toThrow()
    expect(() => uriPath('file://elsewhere/workspace/a.cpp')).toThrow()
    expect(() => uriPath('file:///workspace/a%2F..%2Fb.cpp')).toThrow()
  })

  test('search includes all occurrences in unsaved files and omits deletions', () => {
    const results = searchWorkspace(
      {
        'a.cpp': {
          ...doc('a.cpp', 'speed speed\nSpeed'),
          contents: 'speed speed\nSpeed',
        },
        'b.cpp': { ...doc('b.cpp', 'speed'), deleted: true },
      },
      'speed',
    )

    expect(results.map((result) => [result.line, result.character])).toEqual([
      [0, 0],
      [0, 6],
      [1, 0],
    ])
  })
})

describe('language configuration', () => {
  test('analysis targets ARM and uses real VEX include directories', () => {
    const commands = compileCommands(
      { 'src/main.cpp': '', 'src/a.c': '', 'README.md': '' },
      'vexcode',
      '16.1.0',
    )

    expect(commands).toHaveLength(2)
    expect(commands[0].arguments).toContain('--target=thumbv7-none-eabi')
    expect(commands[0].arguments).toContain('-I/sdk/vexv5/include')
    expect(commands[1].arguments).toContain('-std=gnu99')
  })

  test('custom commands cannot masquerade as shell arguments', () => {
    expect(() =>
      compileCommands(
        { 'compile_commands.json': '[{"command":"run something"}]' },
        'pros',
        '16.1.0',
      ),
    ).toThrow()
  })

  test('semantic token delta encoding handles line resets', () => {
    const result = decodeSemanticTokens(
      { data: [0, 2, 3, 0, 0, 0, 4, 2, 1, 0, 2, 1, 4, 0, 0] },
      { tokenTypes: ['function', 'class'], tokenModifiers: [] },
    )

    expect(result.map((token) => token.range.start)).toEqual([
      { line: 0, character: 2 },
      { line: 0, character: 6 },
      { line: 2, character: 1 },
    ])

    expect(() =>
      decodeSemanticTokens(
        { data: [0, 1] },
        { tokenTypes: [], tokenModifiers: [] },
      ),
    ).toThrow()
  })
})

describe('draft recovery', () => {
  test('preserves drafts while loading unrelated incoming changes', () => {
    const result = recoverDocuments(
      { 'a.cpp': 'old', 'b.cpp': 'incoming' },
      {
        documents: { 'a.cpp': { ...doc('a.cpp', 'old'), contents: 'draft' } },
      },
    )

    expect(result.documents['a.cpp']?.contents).toBe('draft')
    expect(result.documents['b.cpp']?.contents).toBe('incoming')
    expect(result.conflicts).toEqual([])
  })

  test('retains both versions when incoming changes overlap a draft', () => {
    const result = recoverDocuments(
      { 'a.cpp': 'incoming' },
      {
        documents: { 'a.cpp': { ...doc('a.cpp', 'old'), contents: 'draft' } },
      },
    )

    expect(result.documents['a.cpp']?.contents).toBe('draft')
    expect(result.documents['a.cpp']?.baseline).toBe('incoming')
    expect(result.conflicts).toEqual(['a.cpp'])

    expect(recoverDocuments({ 'a.cpp': 'incoming' }, result).conflicts).toEqual(
      ['a.cpp'],
    )
  })

  test('preserves drafts for remotely deleted files and detects addition collisions', () => {
    const result = recoverDocuments(
      { 'new.cpp': 'incoming' },
      {
        documents: {
          'a.cpp': { ...doc('a.cpp', 'old'), contents: 'draft' },
          'new.cpp': { ...doc('new.cpp', 'draft'), baseline: null },
        },
      },
    )

    expect(result.documents['a.cpp']?.baseline).toBeNull()
    expect(result.documents['a.cpp']?.contents).toBe('draft')
    expect(result.conflicts).toEqual(['a.cpp', 'new.cpp'])
  })

  test('recognizes already committed drafts and retains local deletions', () => {
    const result = recoverDocuments(
      { 'a.cpp': 'draft', 'b.cpp': 'old' },
      {
        documents: {
          'a.cpp': { ...doc('a.cpp', 'old'), contents: 'draft' },
          'b.cpp': { ...doc('b.cpp', 'old'), deleted: true },
        },
      },
    )

    expect(isDirty(result.documents['a.cpp']!)).toBe(false)
    expect(isDirty(result.documents['b.cpp']!)).toBe(true)
    expect(result.conflicts).toEqual([])
  })
})

test('folding includes nested multiline symbols and skips single-line declarations', () => {
  const symbol = (start: number, end: number) => ({
    name: 'symbol',
    kind: 12 as const,
    range: {
      start: { line: start, character: 0 },
      end: { line: end, character: 1 },
    },
    selectionRange: {
      start: { line: start, character: 0 },
      end: { line: start, character: 1 },
    },
  })

  expect(
    symbolFoldingRanges([
      { ...symbol(0, 10), children: [symbol(2, 5), symbol(6, 6)] },
      symbol(0, 8),
    ]),
  ).toEqual([
    { startLine: 0, endLine: 10 },
    { startLine: 2, endLine: 5 },
  ])
})
