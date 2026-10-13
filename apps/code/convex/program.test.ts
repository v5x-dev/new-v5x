/// <reference types="vite/client" />
import { describe, expect, vi, test } from 'vitest'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
const spyOn = vi.spyOn
import { convexTest } from 'convex-test'
import type { PaginationResult } from 'convex/server'
import type { Doc } from './_generated/dataModel'
import { api, internal } from './_generated/api'
import schema from './schema'
import { isAllowedBrainOrigin } from './simulatorHandoff'

// These tests never contact storage. Supply a non-secret constructor value.
const priorStorageKey = process.env.PIERRE_PRIVATE_KEY
process.env.PIERRE_PRIVATE_KEY ??= 'authorization-test-only'
const program = await import('./program')
if (priorStorageKey === undefined) delete process.env.PIERRE_PRIVATE_KEY

const modules = import.meta.glob('./**/*.ts')
function backend() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  return t
}

describe('program repository authorization', () => {
  test('repository registration is internal and has no public single-file save bypass', () => {
    expect(program.create).toHaveProperty('isInternal', true)
    expect(program.create).not.toHaveProperty('isPublic', true)
    expect(program).not.toHaveProperty('saveProgramFile')
  })

  test('trusted creation derives ownership from the authenticated caller', async () => {
    const t = backend()
    const owner = t.withIdentity({ subject: 'owner' })
    const id = await owner.mutation(internal.program.create, {
      name: 'Robot',
      repoId: 'trusted-repository',
      commitSha: 'initial-commit',
    })
    expect(await owner.query(api.program.get, { programId: id })).toMatchObject(
      {
        repoId: 'trusted-repository',
        ownerId: 'owner',
      },
    )
    expect(
      await t
        .withIdentity({ subject: 'other' })
        .query(api.program.get, { programId: id }),
    ).toBeNull()
    await expect(
      t.mutation(internal.program.create, {
        name: 'Robot',
        repoId: 'arbitrary',
        commitSha: 'commit',
      }),
    ).rejects.toThrow('Unauthorized')
  })

  test('another user cannot read or commit through an owned program', async () => {
    const t = backend()
    const id = await t
      .withIdentity({ subject: 'owner' })
      .mutation(internal.program.create, {
        name: 'Robot',
        repoId: 'private-repository',
        commitSha: 'initial-commit',
      })
    const stranger = t.withIdentity({ subject: 'other' })
    await expect(
      stranger.action(api.program.getProgramFiles, { programId: id }),
    ).rejects.toThrow('Program not found')
    await expect(
      stranger.action(api.program.getProgramFile, {
        programId: id,
        path: 'src/main.cpp',
      }),
    ).rejects.toThrow('Program not found')
    await expect(
      stranger.action(api.program.getWorkspaceSnapshot, { programId: id }),
    ).rejects.toThrow('Program commit is still loading')
    await expect(
      stranger.action(api.program.commitWorkspace, {
        programId: id,
        expectedCommitSha: 'initial-commit',
        message: 'Overwrite',
        changes: [{ path: 'src/main.cpp', contents: 'malicious' }],
      }),
    ).rejects.toThrow('Program not found')
    expect(
      await t.withIdentity({ subject: 'owner' }).query(api.program.list, {}),
    ).toHaveLength(1)
    expect(await stranger.query(api.program.list, {})).toEqual([])
  })
})

test('simulator handoff allows only configured Brain origins', () => {
  expect(isAllowedBrainOrigin('https://brain.v5x.dev')).toBe(true)
  expect(isAllowedBrainOrigin('http://localhost:5173')).toBe(false)
  expect(isAllowedBrainOrigin('https://attacker.example')).toBe(false)
  expect(isAllowedBrainOrigin(null)).toBe(false)
  const previous = process.env.V5X_BRAIN_ORIGINS
  process.env.V5X_BRAIN_ORIGINS = 'http://localhost:5173'
  try {
    expect(isAllowedBrainOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedBrainOrigin('http://localhost:3103')).toBe(false)
  } finally {
    if (previous === undefined) delete process.env.V5X_BRAIN_ORIGINS
    else process.env.V5X_BRAIN_ORIGINS = previous
  }
})

test('simulator handoff binds one binary to one unexpired token', async () => {
  const t = backend()
  const owner = t.withIdentity({ subject: 'owner' })
  const programId = await owner.mutation(internal.program.create, {
    name: 'Simulator fixture',
    repoId: 'simulator-repository',
    commitSha: 'commit-1',
    template: 'vexcode',
  })
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(['vexcode binary'])),
  )
  const tokenHash = 'f'.repeat(64)
  const now = Date.now()
  await t.mutation(internal.simulatorHandoff.insertTransfer, {
    tokenHash,
    ownerId: 'owner',
    programId,
    expectedCommitSha: 'commit-1',
    sourceSha256: 'a'.repeat(64),
    artifactSha256: 'b'.repeat(64),
    artifactSize: 14,
    expiresAt: now + 5000,
  })
  await t.mutation(internal.simulatorHandoff.attachArtifact, {
    tokenHash,
    ownerId: 'owner',
    storageId,
  })
  const result = await t.mutation(internal.simulatorHandoff.consume, {
    tokenHash,
    now: now + 1000,
  })
  expect(result).toMatchObject({
    storageId,
    manifest: {
      version: 1,
      template: 'vexcode',
      commitSha: 'commit-1',
      sourceSha256: 'a'.repeat(64),
      artifact: {
        path: 'build/workspace.bin',
        size: 14,
        sha256: 'b'.repeat(64),
      },
    },
  })
  expect(
    await t.mutation(internal.simulatorHandoff.consume, {
      tokenHash,
      now: now + 1001,
    }),
  ).toBeNull()
})

test('guest linking preserves IDs, commits, and existing account projects and is repeatable', async () => {
  const t = backend()
  const guest = t.withIdentity({ subject: 'guest' })
  const account = t.withIdentity({ subject: 'account' })
  const guestId = await guest.mutation(internal.program.create, {
    name: 'Guest robot',
    repoId: 'guest-repo',
    commitSha: 'guest-commit',
  })
  const existingId = await account.mutation(internal.program.create, {
    name: 'Account robot',
    repoId: 'account-repo',
    commitSha: 'account-commit',
  })
  expect(program.transferGuestPrograms).toHaveProperty('isInternal', true)
  await t.mutation(internal.program.transferGuestPrograms, {
    guestId: 'guest',
    accountId: 'account',
  })
  await t.mutation(internal.program.transferGuestPrograms, {
    guestId: 'guest',
    accountId: 'account',
  })
  expect(
    await account.query(api.program.get, { programId: guestId }),
  ).toMatchObject({
    _id: guestId,
    currentCommitSha: 'guest-commit',
    ownerId: 'account',
  })
  expect(
    await account.query(api.program.get, { programId: existingId }),
  ).toMatchObject({ repoId: 'account-repo' })
  expect(await guest.query(api.program.get, { programId: guestId })).toBeNull()
  expect(await account.query(api.program.list, {})).toHaveLength(2)
})

test('rename and archive are owner-only and preserve recoverable project sources', async () => {
  const t = backend()
  const owner = t.withIdentity({ subject: 'owner' })
  const stranger = t.withIdentity({ subject: 'stranger' })
  const id = await owner.mutation(internal.program.create, {
    name: 'Original',
    repoId: 'repository',
    commitSha: 'commit',
  })
  await expect(
    stranger.mutation(api.program.rename, { programId: id, name: 'Stolen' }),
  ).rejects.toThrow('Program not found')
  await expect(
    stranger.mutation(api.program.setArchived, {
      programId: id,
      archived: true,
    }),
  ).rejects.toThrow('Program not found')
  await expect(
    owner.mutation(api.program.rename, { programId: id, name: ' ' }),
  ).rejects.toThrow('Name must')
  await expect(
    owner.mutation(api.program.rename, {
      programId: id,
      name: 'x'.repeat(121),
    }),
  ).rejects.toThrow('Name must')
  await owner.mutation(api.program.rename, {
    programId: id,
    name: '  Chassis  ',
  })
  await owner.mutation(api.program.setArchived, {
    programId: id,
    archived: true,
  })
  const active = await owner.query(api.program.listPaginated, {
    archived: false,
    paginationOpts: { cursor: null, numItems: 10 },
  })
  expect(active.page).toEqual([])
  const archive = await owner.query(api.program.listPaginated, {
    archived: true,
    paginationOpts: { cursor: null, numItems: 10 },
  })
  expect(archive.page).toMatchObject([
    {
      _id: id,
      name: 'Chassis',
      repoId: 'repository',
      currentCommitSha: 'commit',
    },
  ])
  expect(
    (
      await stranger.query(api.program.listPaginated, {
        archived: true,
        paginationOpts: { cursor: null, numItems: 10 },
      })
    ).page,
  ).toEqual([])
  await owner.mutation(api.program.setArchived, {
    programId: id,
    archived: false,
  })
  expect(await owner.query(api.program.list, {})).toHaveLength(1)
})

test('project deletion retries after storage failure and removes builds in batches', async () => {
  const { store } = await import('./store')
  const removeRepo = spyOn(store, 'deleteRepo')
    .mockRejectedValueOnce(new Error('storage timeout'))
    .mockRejectedValueOnce(new Error('Repository not found'))
  try {
    const t = backend()
    const owner = t.withIdentity({ subject: 'owner' })
    const stranger = t.withIdentity({ subject: 'stranger' })
    const programId = await owner.mutation(internal.program.create, {
      name: 'Delete fixture',
      repoId: 'delete-repository',
      commitSha: 'head',
    })
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['compiled binary'])),
    )
    await t.run(async (ctx) => {
      await ctx.db.insert('programBuildCache', {
        programId,
        commitSha: 'head',
        exitCode: 0,
        stdout: '',
        stderr: '',
        artifacts: [{ path: 'build/robot.bin', storageId }],
        timings: [],
      })
      for (let index = 0; index < 205; index++) {
        await ctx.db.insert('programBuilds', {
          programId,
          commitSha: `commit-${index}`,
        })
      }
    })

    await stranger.action(api.program.deleteProgram, { programId })
    expect(removeRepo).not.toHaveBeenCalled()

    await expect(
      owner.action(api.program.deleteProgram, { programId }),
    ).rejects.toThrow('storage timeout')
    expect(await owner.query(api.program.get, { programId })).toBeNull()
    await owner.action(api.program.deleteProgram, { programId })
    expect(removeRepo).toHaveBeenCalledTimes(2)
    expect(await owner.query(api.program.get, { programId })).toBeNull()
    expect(await t.run((ctx) => ctx.db.get('program', programId))).toBeNull()
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('programBuilds')
          .withIndex('by_program_commit', (q) => q.eq('programId', programId))
          .take(1),
      ),
    ).toEqual([])
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('programBuildCache')
          .withIndex('by_program', (q) => q.eq('programId', programId))
          .unique(),
      ),
    ).toBeNull()
  } finally {
    removeRepo.mockRestore()
  }
})

test('project listing paginates legacy active records without missing or repeating them', async () => {
  const t = backend()
  const owner = t.withIdentity({ subject: 'owner' })
  for (let index = 0; index < 5; index++) {
    await owner.mutation(internal.program.create, {
      name: `Robot ${index}`,
      repoId: `repo-${index}`,
      commitSha: 'commit',
    })
  }
  let cursor: string | null = null
  const seen = new Set<string>()
  for (let index = 0; index < 5; index++) {
    const page: PaginationResult<Doc<'program'>> = await owner.query(
      api.program.listPaginated,
      {
        archived: false,
        paginationOpts: { cursor, numItems: 2 },
      },
    )
    for (const program of page.page) {
      expect(seen.has(program._id)).toBe(false)
      seen.add(program._id)
    }
    if (page.isDone) break
    cursor = page.continueCursor
  }
  expect(seen.size).toBe(5)
  await expect(
    owner.query(api.program.listPaginated, {
      archived: false,
      paginationOpts: { cursor: null, numItems: 0 },
    }),
  ).rejects.toThrow('Invalid page size')
})

test('duplication forks the owned commit into a new repository and keeps the template', async () => {
  const { store } = await import('./store')
  const createRepo = spyOn(store, 'createRepo').mockResolvedValue({
    id: 'new-repository',
  } as Awaited<ReturnType<typeof store.createRepo>>)
  try {
    const t = backend()
    const owner = t.withIdentity({ subject: 'owner' })
    const id = await owner.mutation(internal.program.create, {
      name: 'Robot',
      repoId: 'owned-repository',
      commitSha: 'owned-commit',
      template: 'pros',
    })
    await expect(
      t
        .withIdentity({ subject: 'stranger' })
        .action(api.program.duplicate, { programId: id }),
    ).rejects.toThrow('Program not found')
    expect(createRepo).not.toHaveBeenCalled()
    const copyId = await owner.action(api.program.duplicate, { programId: id })
    expect(copyId).not.toBe(id)
    expect(createRepo).toHaveBeenCalledWith({
      id: expect.any(String),
      baseRepo: { id: 'owned-repository', sha: 'owned-commit' },
    })
    expect(
      await owner.query(api.program.get, { programId: copyId }),
    ).toMatchObject({
      name: 'Robot copy',
      repoId: 'new-repository',
      currentCommitSha: 'owned-commit',
      template: 'pros',
    })
    expect(await owner.query(api.program.get, { programId: id })).toMatchObject(
      { repoId: 'owned-repository' },
    )
  } finally {
    createRepo.mockRestore()
  }
})

test('source imports validate before allocating repositories and register only the created repository', async () => {
  const { store } = await import('./store')
  const { authComponent } = await import('./betterAuth/auth')
  const builder = {
    addFileFromString: vi.fn(),
    send: vi.fn().mockResolvedValue({ commitSha: 'import-commit' }),
  }
  const createCommit = vi.fn().mockReturnValue(builder)
  const createRepo = spyOn(store, 'createRepo').mockResolvedValue({
    id: 'import-repository',
    defaultBranch: 'main',
    createCommit,
  } as unknown as Awaited<ReturnType<typeof store.createRepo>>)
  const profile = spyOn(authComponent, 'getAuthUser').mockResolvedValue({
    name: 'Guest',
    email: 'guest@example.invalid',
  } as Awaited<ReturnType<typeof authComponent.getAuthUser>>)
  try {
    const t = backend()
    const owner = t.withIdentity({ subject: 'owner' })
    const args = {
      name: 'Imported robot',
      template: 'pros' as const,
      files: [{ path: 'src/main.cpp', contents: 'int main() {}' }],
    }
    await expect(t.action(api.program.importSources, args)).rejects.toThrow(
      'Unauthorized',
    )
    await expect(
      owner.action(api.program.importSources, {
        ...args,
        files: [{ path: '../private', contents: 'x' }],
      }),
    ).rejects.toThrow('Invalid source path')
    expect(createRepo).not.toHaveBeenCalled()
    const id = await owner.action(api.program.importSources, args)
    expect(createCommit).toHaveBeenCalledWith({
      targetBranch: 'main',
      commitMessage: 'Import project sources',
      author: { name: 'Guest', email: 'guest@example.invalid' },
    })
    expect(builder.addFileFromString).toHaveBeenCalledWith(
      'src/main.cpp',
      'int main() {}',
    )
    expect(await owner.query(api.program.get, { programId: id })).toMatchObject(
      {
        name: 'Imported robot',
        repoId: 'import-repository',
        currentCommitSha: 'import-commit',
        ownerId: 'owner',
        template: 'pros',
      },
    )
  } finally {
    createRepo.mockRestore()
    profile.mockRestore()
  }
})

test('history reads and restores authorize before storage access and reject stale heads', async () => {
  const { store } = await import('./store')
  const { authComponent } = await import('./betterAuth/auth')
  const repo = {
    defaultBranch: 'main',
    listCommits: vi.fn().mockResolvedValue({
      commits: [
        {
          sha: 'older',
          message: 'Earlier work',
          authorName: 'Owner',
          date: new Date(0),
        },
      ],
      hasMore: false,
    }),
    getCommitDiff: vi.fn().mockResolvedValue({
      files: [{ path: 'src/main.cpp', raw: 'patch' }],
      filteredFiles: [],
    }),
    getCommit: vi.fn().mockResolvedValue({ commit: { sha: 'older' } }),
    restoreCommit: vi
      .fn()
      .mockResolvedValue({ commitSha: 'restored-new-head' }),
  }
  const storage = spyOn(store, 'repo').mockReturnValue(
    repo as unknown as ReturnType<typeof store.repo>,
  )
  const profile = spyOn(authComponent, 'getAuthUser').mockResolvedValue({
    name: 'Owner',
    email: 'owner@example.invalid',
  } as Awaited<ReturnType<typeof authComponent.getAuthUser>>)
  try {
    const t = backend()
    const owner = t.withIdentity({ subject: 'owner' })
    const stranger = t.withIdentity({ subject: 'stranger' })
    const id = await owner.mutation(internal.program.create, {
      name: 'Robot',
      repoId: 'owned-repo',
      commitSha: 'head',
    })
    await expect(
      stranger.action(api.programHistory.list, { programId: id }),
    ).rejects.toThrow('Program not found')
    await expect(
      stranger.action(api.programHistory.diff, {
        programId: id,
        commitSha: 'older',
      }),
    ).rejects.toThrow('Program not found')
    await expect(
      stranger.action(api.programHistory.restore, {
        programId: id,
        commitSha: 'older',
        expectedCommitSha: 'head',
      }),
    ).rejects.toThrow('Program not found')
    await expect(
      owner.action(api.programHistory.restore, {
        programId: id,
        commitSha: 'older',
        expectedCommitSha: 'stale',
      }),
    ).rejects.toThrow('project changed')
    expect(storage).not.toHaveBeenCalled()
    expect(
      await owner.action(api.programHistory.list, { programId: id }),
    ).toMatchObject({
      head: 'head',
      commits: [{ sha: 'older', date: '1970-01-01T00:00:00.000Z' }],
      cursor: null,
    })
    expect(repo.listCommits).toHaveBeenCalledWith({
      branch: 'head',
      limit: 30,
      cursor: undefined,
    })
    expect(
      await owner.action(api.programHistory.restore, {
        programId: id,
        commitSha: 'older',
        expectedCommitSha: 'head',
      }),
    ).toBe('restored-new-head')
    expect(repo.restoreCommit).toHaveBeenCalledWith({
      targetBranch: 'main',
      targetCommitSha: 'older',
      expectedHeadSha: 'head',
      commitMessage: 'Restore sources from older',
      author: { name: 'Owner', email: 'owner@example.invalid' },
    })
    expect(await owner.query(api.program.get, { programId: id })).toMatchObject(
      { currentCommitSha: 'restored-new-head' },
    )
    repo.restoreCommit.mockRejectedValueOnce(new Error('Head changed'))
    await expect(
      owner.action(api.programHistory.restore, {
        programId: id,
        commitSha: 'older',
        expectedCommitSha: 'restored-new-head',
      }),
    ).rejects.toThrow('Head changed')
    expect(await owner.query(api.program.get, { programId: id })).toMatchObject(
      { currentCommitSha: 'restored-new-head' },
    )
  } finally {
    storage.mockRestore()
    profile.mockRestore()
  }
})

test('account stars persist and follow guest ownership transfer', async () => {
  const t = backend()
  const guest = t.withIdentity({ subject: 'guest' })
  const id = await guest.mutation(internal.program.create, {
    name: 'Robot',
    repoId: 'star-repo',
    commitSha: 'commit',
  })
  await guest.mutation(api.program.setStarred, { programId: id, starred: true })
  expect(await guest.query(api.program.get, { programId: id })).toMatchObject({
    starred: true,
  })
  await expect(
    t.withIdentity({ subject: 'stranger' }).mutation(api.program.setStarred, {
      programId: id,
      starred: false,
    }),
  ).rejects.toThrow('Program not found')
  await expect(
    t.mutation(api.program.setStarred, { programId: id, starred: false }),
  ).rejects.toThrow('Unauthorized')
  await t.mutation(internal.program.transferGuestPrograms, {
    guestId: 'guest',
    accountId: 'account',
  })
  const account = t.withIdentity({ subject: 'account' })
  expect(await account.query(api.program.get, { programId: id })).toMatchObject(
    { starred: true },
  )
  await account.mutation(api.program.setStarred, {
    programId: id,
    starred: false,
  })
  expect(await account.query(api.program.get, { programId: id })).toMatchObject(
    { starred: false },
  )
})

test('dashboard pagination applies global name order, substring search and account stars', async () => {
  const t = backend()
  const owner = t.withIdentity({ subject: 'owner' })
  for (const name of ['Zulu robot', 'Alpha chassis', 'Beta robot']) {
    const id = await owner.mutation(internal.program.create, {
      name,
      repoId: name,
      commitSha: 'commit',
    })
    if (name === 'Alpha chassis')
      await owner.mutation(api.program.setStarred, {
        programId: id,
        starred: true,
      })
  }
  await t
    .withIdentity({ subject: 'stranger' })
    .mutation(internal.program.create, {
      name: 'Aardvark robot',
      repoId: 'private',
      commitSha: 'commit',
    })
  const first = await owner.query(api.program.listPaginated, {
    archived: false,
    sort: 'name',
    paginationOpts: { numItems: 1, cursor: null },
  })
  expect(first.page.map((p) => p.name)).toEqual(['Alpha chassis'])
  const second = await owner.query(api.program.listPaginated, {
    archived: false,
    sort: 'name',
    paginationOpts: { numItems: 1, cursor: first.continueCursor },
  })
  expect(second.page.map((p) => p.name)).toEqual(['Beta robot'])
  const stars = await owner.query(api.program.listPaginated, {
    archived: false,
    starredOnly: true,
    paginationOpts: { numItems: 50, cursor: null },
  })
  expect(stars.page.map((p) => p.name)).toEqual(['Alpha chassis'])
  let cursor: string | null = null
  const matches: string[] = []
  for (let page = 0; page < 4; page++) {
    const result: PaginationResult<Doc<'program'>> = await owner.query(
      api.program.listPaginated,
      {
        archived: false,
        search: 'CHASS',
        paginationOpts: { numItems: 1, cursor },
      },
    )
    matches.push(...result.page.map((p) => p.name))
    if (result.isDone) break
    cursor = result.continueCursor
  }
  expect(matches).toEqual(['Alpha chassis'])
})

test('reactive pagination accepts expanded pages beyond the initial size', async () => {
  const owner = backend().withIdentity({ subject: 'owner' })
  const result = await owner.query(api.program.listPaginated, {
    archived: false,
    paginationOpts: { numItems: 150, cursor: null },
  })
  expect(result.isDone).toBe(true)
  expect(result.page).toEqual([])
})
