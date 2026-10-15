import { describe, expect, test } from 'bun:test'
import { restoredTabs } from './load-workspace'
import { restoreBaseline, type Documents } from './workspace'

const documents: Documents = {
  'src/main.cpp': {
    path: 'src/main.cpp',
    contents: 'draft',
    baseline: 'committed',
    version: 2,
  },
  'src/new.cpp': {
    path: 'src/new.cpp',
    contents: 'new',
    baseline: null,
    version: 1,
  },
  'src/old.cpp': {
    path: 'src/old.cpp',
    contents: '',
    baseline: 'old',
    version: 1,
    deleted: true,
  },
}

const saved = (tabs: Array<string>, selectedFile: string) => ({
  documents,
  commitSha: 'sha',
  tabs,
  selectedFile,
})

describe('restoredTabs', () => {
  test('keeps live tabs and the saved selection', () => {
    expect(
      restoredTabs(
        saved(['src/old.cpp', 'src/new.cpp', 'missing.cpp'], 'src/main.cpp'),
        documents,
        'src/new.cpp',
      ),
    ).toEqual({
      tabs: ['src/new.cpp', 'src/main.cpp'],
      selectedFile: 'src/main.cpp',
    })
  })

  test('falls back to the requested file', () => {
    expect(
      restoredTabs(saved([], 'src/old.cpp'), documents, 'src/new.cpp'),
    ).toEqual({ tabs: ['src/new.cpp'], selectedFile: 'src/new.cpp' })
    expect(restoredTabs(undefined, documents, '')).toEqual({
      tabs: [],
      selectedFile: '',
    })
  })
})

describe('restoreBaseline', () => {
  test('replaces a draft with the committed text', () => {
    const { next, baseline, pathsChanged } = restoreBaseline(
      documents,
      'src/main.cpp',
    )
    expect(next['src/main.cpp']).toMatchObject({
      contents: 'committed',
      version: 3,
      deleted: false,
    })
    expect(baseline).toBe('committed')
    expect(pathsChanged).toBe(false)
    expect(documents['src/main.cpp']?.contents).toBe('draft')
  })

  test('removes new files and restores deleted ones', () => {
    expect(restoreBaseline(documents, 'src/new.cpp')).toMatchObject({
      baseline: null,
      pathsChanged: true,
    })
    expect(
      'src/new.cpp' in restoreBaseline(documents, 'src/new.cpp').next,
    ).toBe(false)

    const restored = restoreBaseline(documents, 'src/old.cpp')
    expect(restored.pathsChanged).toBe(true)
    expect(restored.next['src/old.cpp']).toMatchObject({
      contents: 'old',
      deleted: false,
    })
  })
})
