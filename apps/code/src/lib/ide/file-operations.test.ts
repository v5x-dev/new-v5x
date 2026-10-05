import { describe, expect, test } from 'bun:test'
import { applyFileOperation, readFiles } from './file-operations'
import { isDirty, recoverDocuments, workspaceDocuments } from './workspace'

const snapshot = () =>
  recoverDocuments({
    'src/main.cpp': 'draft source',
    'src/nested/helper.cpp': 'helper',
    'README.md': 'readme',
  }).documents

describe('file operations', () => {
  test('moving a folder preserves drafts and produces Git additions and deletions', () => {
    const docs = snapshot()
    docs['src/main.cpp']!.contents = 'unsaved edit'
    const next = applyFileOperation(docs, {
      kind: 'move',
      path: 'src',
      to: 'source',
    })
    expect(readFiles(next, 'source')).toEqual({
      'source/main.cpp': 'unsaved edit',
      'source/nested/helper.cpp': 'helper',
    })
    expect(readFiles(next, 'src')).toEqual({})
    expect(next['src/main.cpp']!.deleted).toBe(true)
    expect(workspaceDocuments(next).filter(isDirty)).toHaveLength(4)
    expect(readFiles(docs, 'src')['src/main.cpp']).toBe('unsaved edit')
  })
  test('invalid destinations cannot partially mutate the workspace', () => {
    const docs = snapshot()
    for (const to of [
      'src/nested/moved',
      'README.md/subfolder',
      '../outside',
      '/absolute',
      'src',
    ]) {
      if (to === 'src') continue
      expect(() =>
        applyFileOperation(docs, { kind: 'move', path: 'src', to }),
      ).toThrow()
    }
    expect(() =>
      applyFileOperation(docs, { kind: 'create', path: 'src' }),
    ).toThrow()
    expect(readFiles(docs, 'src')['src/main.cpp']).toBe('draft source')
    expect(docs['src/main.cpp']!.deleted).toBeUndefined()
  })
  test('copy uses clipboard contents and keeps the source intact', () => {
    const docs = snapshot()
    const files = readFiles(docs, 'src')
    docs['src/main.cpp']!.contents = 'later edit'
    const next = applyFileOperation(docs, {
      kind: 'copy',
      path: 'src',
      to: 'backup',
      files,
    })
    expect(next['backup/main.cpp']!.contents).toBe('draft source')
    expect(next['src/main.cpp']!.contents).toBe('later edit')
    expect(() =>
      applyFileOperation(next, {
        kind: 'copy',
        path: 'src',
        to: 'backup',
        files,
      }),
    ).toThrow()
  })
  test('new empty folders survive recovery and deletion of uncommitted files is clean', () => {
    const docs = snapshot()
    const created = applyFileOperation(docs, {
      kind: 'create',
      path: 'empty',
      folder: true,
    })
    expect(created['empty/.gitkeep']!.baseline).toBeNull()
    const recovered = recoverDocuments(
      { 'README.md': 'readme' },
      { documents: created },
    ).documents
    expect(recovered['empty/.gitkeep']!.contents).toBe('')
    const deleted = applyFileOperation(created, {
      kind: 'delete',
      path: 'empty',
    })
    expect(deleted['empty/.gitkeep']).toBeUndefined()
    expect(workspaceDocuments(deleted).some(isDirty)).toBe(false)
  })
  test('recreating a deleted committed file keeps its original baseline', () => {
    const removed = applyFileOperation(snapshot(), {
      kind: 'delete',
      path: 'README.md',
    })
    const recreated = applyFileOperation(removed, {
      kind: 'create',
      path: 'README.md',
    })
    expect(recreated['README.md']!.baseline).toBe('readme')
    expect(recreated['README.md']!.deleted).toBeUndefined()
  })
})
