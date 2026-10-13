import { expect, test } from 'bun:test'
import { workspaceIO } from './workspace-io'

test('a remounted editor reads after the departing editor finishes saving', async () => {
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  let stored = 'old'
  const save = workspaceIO('remount', async () => {
    await blocked
    stored = 'latest'
  })
  const read = workspaceIO('remount', async () => stored)
  release()
  await save
  expect(await read).toBe('latest')
})

test('a failed write does not block recovery or writes to another project', async () => {
  const fail = workspaceIO('failed', async () => {
    throw new Error('quota')
  })
  await expect(fail).rejects.toThrow('quota')
  expect(await workspaceIO('other', async () => 'other draft')).toBe(
    'other draft',
  )
  expect(await workspaceIO('failed', async () => 'recovered')).toBe('recovered')
})
