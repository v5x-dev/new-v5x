import { expect, test } from 'bun:test'
import { DraftWriter } from './draft-writer'
import type { SavedWorkspace } from './persistence'

function snapshot(contents: string): SavedWorkspace {
  return {
    documents: {
      'main.cpp': { path: 'main.cpp', contents, baseline: '', version: 1 },
    },
    commitSha: 'commit',
    tabs: ['main.cpp'],
    selectedFile: 'main.cpp',
  }
}

test('flushing during navigation keeps the latest pending draft', async () => {
  const writes: SavedWorkspace[] = []
  const writer = new DraftWriter(
    async (value) => {
      writes.push(value)
    },
    () => {},
    60_000,
  )
  writer.schedule(snapshot('old'))
  writer.schedule(snapshot('latest'))
  await writer.flush()
  expect(writes.map((value) => value.documents['main.cpp']?.contents)).toEqual([
    'latest',
  ])
})

test('writes are serialized even when a newer edit arrives during storage I/O', async () => {
  let finishFirst!: () => void
  const blocked = new Promise<void>((resolve) => {
    finishFirst = resolve
  })
  const writes: string[] = []
  const states: string[] = []
  const writer = new DraftWriter(
    async (value) => {
      const contents = value.documents['main.cpp']!.contents
      if (contents === 'first') await blocked
      writes.push(contents)
    },
    (status) => {
      states.push(status)
    },
    60_000,
  )
  writer.schedule(snapshot('first'))
  const first = writer.flush()
  writer.schedule(snapshot('second'))
  const second = writer.flush()
  finishFirst()
  await Promise.all([first, second])
  expect(writes).toEqual(['first', 'second'])
  expect(states).toEqual(['saving', 'saving', 'saved'])
})

test('quota failures remain visible and the unsaved snapshot can be retried', async () => {
  let fail = true
  const states: string[] = []
  const writer = new DraftWriter(
    async () => {
      if (fail) throw new Error('Quota exceeded')
    },
    (status, error) => {
      states.push(error ?? status)
    },
    60_000,
  )
  writer.schedule(snapshot('recover me'))
  await writer.flush()
  expect(states).toEqual(['saving', 'Quota exceeded'])
  fail = false
  await writer.flush()
  expect(states.at(-1)).toBe('saved')
})
