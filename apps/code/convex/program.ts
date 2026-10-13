import { v } from 'convex/values'
import { validateSourceFiles } from '../src/lib/source-files'
import { paginationOptsValidator } from 'convex/server'
import boring from 'boring-name-generator'
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import { store } from './store'
import { internal } from './_generated/api'
import { initializeTemplate } from './template'
import { authComponent } from './betterAuth/auth'
import type { ProgramTemplate } from './template'
import type { Doc, Id } from './_generated/dataModel'

export const createProgram = action({
  args: {
    name: v.optional(v.string()),
    template: v.optional(
      v.union(
        v.literal('vexcode'),
        v.literal('pros'),
        v.literal('ez-template'),
        v.literal('jar-template'),
      ),
    ),
  },
  handler: async (ctx, args): Promise<Id<'program'>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')
    const user = await authComponent.getAuthUser(ctx)

    await ctx.runMutation(internal.quotas.consumeProjectCreation, {})
    const repo = await store.createRepo({
      id: boring({ words: 2, number: true }).dashed,
    })

    const template: ProgramTemplate = args.template ?? 'vexcode'

    const initialCommit = await initializeTemplate(repo, template, {
      name: user.name,
      email: user.email,
    })

    const programId: Id<'program'> = await ctx.runMutation(
      internal.program.create,
      {
        name: args.name || repo.id,
        repoId: repo.id,
        template,
        commitSha: initialCommit.commitSha,
      },
    )

    return programId
  },
})

export const create = internalMutation({
  args: {
    name: v.string(),
    repoId: v.string(),
    commitSha: v.string(),
    template: v.optional(
      v.union(
        v.literal('vexcode'),
        v.literal('pros'),
        v.literal('ez-template'),
        v.literal('jar-template'),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')

    return await ctx.db.insert('program', {
      name: args.name,
      repoId: args.repoId,
      ownerId: identity.subject,
      currentCommitSha: args.commitSha,
      ...(args.template ? { template: args.template } : {}),
    })
  },
})

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')

    return await ctx.db
      .query('program')
      .withIndex('by_owner_and_archived', (q) =>
        q.eq('ownerId', identity.subject).eq('archived', undefined),
      )
      .order('desc')
      .take(100)
  },
})

export const get = query({
  args: {
    programId: v.id('program'),
  },
  handler: async (ctx, { programId }): Promise<Doc<'program'> | null> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')

    const program = await ctx.db.get('program', programId)
    if (!program || program.ownerId !== identity.subject || program.deleting)
      return null

    return program
  },
})

export const getOwned = internalQuery({
  args: {
    programId: v.id('program'),
    ownerId: v.string(),
  },
  handler: async (ctx, { programId, ownerId }) => {
    const program = await ctx.db.get('program', programId)
    if (!program || program.ownerId !== ownerId || program.deleting) return null

    return program
  },
})

export const getDeletionTarget = internalQuery({
  args: { programId: v.id('program'), ownerId: v.string() },
  handler: async (ctx, { programId, ownerId }) => {
    const program = await ctx.db.get('program', programId)
    if (!program || program.ownerId !== ownerId) return null
    return program
  },
})

export const markDeleting = internalMutation({
  args: { programId: v.id('program'), ownerId: v.string() },
  handler: async (ctx, { programId, ownerId }) => {
    const program = await ctx.db.get('program', programId)
    if (!program || program.ownerId !== ownerId)
      throw new Error('Program not found')
    if (!program.deleting)
      await ctx.db.patch('program', programId, { deleting: true })
    return null
  },
})

export const cleanDeletionBatch = internalMutation({
  args: { programId: v.id('program') },
  handler: async (ctx, { programId }) => {
    const program = await ctx.db.get('program', programId)
    if (!program?.deleting) throw new Error('Program deletion is not active')

    const cache = await ctx.db
      .query('programBuildCache')
      .withIndex('by_program', (q) => q.eq('programId', programId))
      .unique()

    if (cache) {
      for (const artifact of cache.artifacts)
        await ctx.storage.delete(artifact.storageId)
      if (cache.warmMachineId) {
        await ctx.scheduler.runAfter(0, internal.programBuild.deleteMachine, {
          machineId: cache.warmMachineId,
        })
      }
      await ctx.db.delete('programBuildCache', cache._id)
    }

    const builds = await ctx.db
      .query('programBuilds')
      .withIndex('by_program_commit', (q) => q.eq('programId', programId))
      .take(201)
    for (const build of builds.slice(0, 200))
      await ctx.db.delete('programBuilds', build._id)

    const handoffs = await ctx.db
      .query('simulatorHandoffs')
      .withIndex('by_program', (q) => q.eq('programId', programId))
      .take(11)
    for (const handoff of handoffs.slice(0, 10)) {
      if (handoff.storageId) await ctx.storage.delete(handoff.storageId)
      await ctx.db.delete('simulatorHandoffs', handoff._id)
    }

    return { hasMore: builds.length > 200 || handoffs.length > 10 }
  },
})

export const finishDeletion = internalMutation({
  args: { programId: v.id('program') },
  handler: async (ctx, { programId }) => {
    const program = await ctx.db.get('program', programId)
    if (!program?.deleting) throw new Error('Program deletion is not active')
    const remainingBuild = await ctx.db
      .query('programBuilds')
      .withIndex('by_program_commit', (q) => q.eq('programId', programId))
      .first()
    if (remainingBuild) throw new Error('Project build cleanup is incomplete')
    await ctx.db.delete('program', programId)
    return null
  },
})

/** Delete an owned project and its repository and cached build artifacts. */
export const deleteProgram = action({
  args: { programId: v.id('program') },
  handler: async (ctx, { programId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')

    const program = await ctx.runQuery(internal.program.getDeletionTarget, {
      programId,
      ownerId: identity.subject,
    })
    if (!program) return null

    await ctx.runMutation(internal.program.markDeleting, {
      programId,
      ownerId: identity.subject,
    })

    try {
      await store.deleteRepo({ id: program.repoId })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (
        message !== 'Repository not found' &&
        message !== 'Repository already deleted'
      )
        throw error
    }

    while (true) {
      const result = await ctx.runMutation(
        internal.program.cleanDeletionBatch,
        { programId },
      )
      if (!result.hasMore) break
    }

    await ctx.runMutation(internal.program.finishDeletion, { programId })
    return null
  },
})

export const setCurrentCommitSha = internalMutation({
  args: {
    programId: v.id('program'),
    commitSha: v.string(),
  },
  handler: async (ctx, { programId, commitSha }) => {
    await ctx.db.patch('program', programId, { currentCommitSha: commitSha })
    return null
  },
})

export const hasRunForCommit = query({
  args: { programId: v.id('program'), commitSha: v.string() },
  handler: async (ctx, { programId, commitSha }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return false

    const program = await ctx.db.get('program', programId)
    if (!program || program.ownerId !== identity.subject || program.deleting)
      return false

    return Boolean(
      await ctx.db
        .query('programBuilds')
        .withIndex('by_program_commit', (q) =>
          q.eq('programId', programId).eq('commitSha', commitSha),
        )
        .unique(),
    )
  },
})

export const claimCommitBuild = internalMutation({
  args: { programId: v.id('program'), commitSha: v.string() },
  handler: async (ctx, { programId, commitSha }) => {
    const existing = await ctx.db
      .query('programBuilds')
      .withIndex('by_program_commit', (q) =>
        q.eq('programId', programId).eq('commitSha', commitSha),
      )
      .unique()

    if (existing) return false

    await ctx.db.insert('programBuilds', { programId, commitSha })
    return true
  },
})

export const getProgramFiles = action({
  args: {
    programId: v.id('program'),
  },
  handler: async (
    ctx,
    { programId },
  ): Promise<{ paths: Array<string>; commitSha: string }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')

    const program: Doc<'program'> | null = await ctx.runQuery(
      internal.program.getOwned,
      { programId, ownerId: identity.subject },
    )

    if (!program) throw new Error('Program not found')

    const repo = store.repo({ id: program.repoId })
    let commitSha: string | undefined = program.currentCommitSha

    if (!commitSha) {
      const { commits } = await repo.listCommits({
        branch: repo.defaultBranch,
        limit: 1,
      })

      commitSha = commits[0]?.sha
      if (!commitSha) throw new Error('Program has no commits')

      await ctx.runMutation(internal.program.setCurrentCommitSha, {
        programId,
        commitSha,
      })
    }

    const paths: Array<string> = []
    let cursor: string | undefined
    let hasMore = true

    while (hasMore) {
      const page = await repo.listFiles({
        ref: commitSha,
        recursive: true,
        limit: 1000,
        cursor,
      })

      paths.push(...page.paths)
      if (paths.length > 2000)
        throw new Error('Workspace exceeds the 2000 file limit')
      if (page.hasMore && (!page.nextCursor || page.nextCursor === cursor))
        throw new Error('Repository returned an invalid pagination cursor')
      cursor = page.nextCursor
      hasMore = page.hasMore
    }

    return { paths, commitSha }
  },
})

export const getProgramFile = action({
  args: {
    programId: v.id('program'),
    path: v.string(),
  },
  handler: async (ctx, { programId, path }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')

    const program: Doc<'program'> | null = await ctx.runQuery(
      internal.program.getOwned,
      { programId, ownerId: identity.subject },
    )

    if (!program) throw new Error('Program not found')

    const repo = store.repo({ id: program.repoId })
    if (!program.currentCommitSha) throw new Error('Program has no commit')
    const response = await repo.getFileStream({
      path,
      ref: program.currentCommitSha,
    })
    if (!response.ok) throw new Error(`Unable to load ${path}`)

    return await response.text()
  },
})

/** One immutable source snapshot for local language analysis and project search. */
export const getWorkspaceSnapshot = action({
  args: { programId: v.id('program') },
  handler: async (
    ctx,
    { programId },
  ): Promise<{ files: Record<string, string>; commitSha: string }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')

    const program: Doc<'program'> | null = await ctx.runQuery(
      internal.program.getOwned,
      { programId, ownerId: identity.subject },
    )

    if (!program?.currentCommitSha)
      throw new Error('Program commit is still loading')

    const commitSha = program.currentCommitSha
    const repo = store.repo({ id: program.repoId })
    const paths: Array<string> = []
    let cursor: string | undefined

    do {
      const page = await repo.listFiles({
        ref: commitSha,
        recursive: true,
        limit: 1000,
        cursor,
      })

      paths.push(
        ...page.paths.filter(
          (path) =>
            !/^(build|bin|\.git)\//.test(path) &&
            !/\.(a|o|bin|png|jpg|jpeg|gif|ico|woff2?|zip|pdf)$/i.test(path),
        ),
      )

      if (paths.length > 2000)
        throw new Error('Workspace exceeds the 2000 source file limit')

      cursor = page.hasMore ? page.nextCursor : undefined
    } while (cursor)

    const files: Record<string, string> = {}
    let bytes = 0

    // Bound parallel reads and total snapshot size to Convex action limits.
    for (let index = 0; index < paths.length; index += 8) {
      const batch = await Promise.all(
        paths.slice(index, index + 8).map(async (path) => {
          const response = await repo.getFileStream({ path, ref: commitSha })
          if (!response.ok) throw new Error(`Unable to load ${path}`)
          const contents = await response.text()
          if (contents.includes('\0')) return null
          bytes += new TextEncoder().encode(contents).byteLength

          if (bytes > 8 * 1024 * 1024)
            throw new Error('Workspace exceeds the 8 MiB source snapshot limit')

          return { path, contents }
        }),
      )

      for (const entry of batch) if (entry) files[entry.path] = entry.contents
    }

    return { files, commitSha }
  },
})

/** Commit a reviewed multi-file change against the exact snapshot the user edited. */
export const commitWorkspace = action({
  args: {
    programId: v.id('program'),
    expectedCommitSha: v.string(),
    message: v.string(),
    changes: v.array(
      v.object({ path: v.string(), contents: v.union(v.string(), v.null()) }),
    ),
  },
  handler: async (
    ctx,
    { programId, expectedCommitSha, message, changes },
  ): Promise<string> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')

    const program: Doc<'program'> | null = await ctx.runQuery(
      internal.program.getOwned,
      { programId, ownerId: identity.subject },
    )

    if (!program) throw new Error('Program not found')
    const user = await authComponent.getAuthUser(ctx)

    if (program.currentCommitSha !== expectedCommitSha)
      throw new Error(
        'The project changed. Refresh and resolve incoming changes before committing.',
      )

    if (!changes.length || changes.length > 2000)
      throw new Error('Invalid number of changed files')

    const seen = new Set<string>()
    let bytes = 0

    for (const change of changes) {
      if (
        !change.path ||
        change.path.startsWith('/') ||
        change.path.includes('\\') ||
        change.path.includes('\0') ||
        change.path
          .split('/')
          .some(
            (part) => !part || part === '.' || part === '..' || part === '.git',
          )
      )
        throw new Error('Invalid file path')

      if (seen.has(change.path)) throw new Error('Duplicate changed path')
      seen.add(change.path)
      bytes += new TextEncoder().encode(change.contents ?? '').byteLength

      if (bytes > 8 * 1024 * 1024)
        throw new Error('Commit exceeds the 8 MiB source limit')
    }

    const repo = store.repo({ id: program.repoId })

    const commit = repo.createCommit({
      targetBranch: repo.defaultBranch,
      expectedHeadSha: expectedCommitSha,
      commitMessage: message.trim().slice(0, 2000) || 'Update project',
      author: { name: user.name, email: user.email },
    })

    for (const change of changes) {
      if (change.contents === null) commit.deletePath(change.path)
      else commit.addFileFromString(change.path, change.contents)
    }

    const result = await commit.send()

    await ctx.runMutation(internal.program.setCurrentCommitSha, {
      programId,
      commitSha: result.commitSha,
    })

    return result.commitSha
  },
})

/** Called only by Better Auth's verified anonymous-account linking hook. */
export const transferGuestPrograms = internalMutation({
  args: { guestId: v.string(), accountId: v.string() },
  handler: async (ctx, { guestId, accountId }): Promise<null> => {
    if (!guestId || !accountId) throw new Error('Invalid account transfer')
    if (guestId === accountId) return null
    const programs = await ctx.db
      .query('program')
      .withIndex('by_owner', (q) => q.eq('ownerId', guestId))
      .take(100)
    for (const program of programs) {
      await ctx.db.patch('program', program._id, { ownerId: accountId })
    }
    if (programs.length === 100) {
      await ctx.scheduler.runAfter(0, internal.program.transferGuestPrograms, {
        guestId,
        accountId,
      })
    }
    return null
  },
})

export const listPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    archived: v.boolean(),
    search: v.optional(v.string()),
    sort: v.optional(v.union(v.literal('created'), v.literal('name'))),
    starredOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1
    )
      throw new Error('Invalid page size')
    const needle = (args.search ?? '').trim().toLowerCase()
    if (needle.length > 120) throw new Error('Search is too long')
    const index =
      args.sort === 'name'
        ? 'by_ownerId_and_archived_and_name'
        : 'by_owner_and_archived'
    const ordered = ctx.db
      .query('program')
      .withIndex(index, (q) =>
        q
          .eq('ownerId', identity.subject)
          .eq('archived', args.archived ? true : undefined),
      )
      .order(args.sort === 'name' ? 'asc' : 'desc')
    const filtered = args.starredOnly
      ? ordered.filter((q) => q.eq(q.field('starred'), true))
      : ordered
    const result = await filtered.paginate(args.paginationOpts)
    // Keep native cursors and split metadata. Substring matching scans bounded
    // pages rather than collecting every project into one transaction.
    return {
      ...result,
      page: needle
        ? result.page.filter((program) =>
            program.name.toLowerCase().includes(needle),
          )
        : result.page,
    }
  },
})

export const rename = mutation({
  args: { programId: v.id('program'), name: v.string() },
  handler: async (ctx, { programId, name }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')
    const program = await ctx.db.get('program', programId)
    if (!program || program.ownerId !== identity.subject || program.deleting)
      throw new Error('Program not found')
    const trimmed = name.trim()
    if (
      !trimmed ||
      trimmed.length > 120 ||
      Array.from(trimmed).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new Error(
        'Name must contain 1 to 120 characters without control characters',
      )
    await ctx.db.patch('program', programId, { name: trimmed })
    return null
  },
})

export const setArchived = mutation({
  args: { programId: v.id('program'), archived: v.boolean() },
  handler: async (ctx, { programId, archived }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')
    const program = await ctx.db.get('program', programId)
    if (!program || program.ownerId !== identity.subject || program.deleting)
      throw new Error('Program not found')
    // Absence is the active state, including existing records before this field.
    await ctx.db.patch('program', programId, {
      archived: archived ? true : undefined,
    })
    return null
  },
})

/** Fork only a repository already authorized through the caller's program. */
export const duplicate = action({
  args: { programId: v.id('program') },
  handler: async (ctx, { programId }): Promise<Id<'program'>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')
    const program: Doc<'program'> | null = await ctx.runQuery(
      internal.program.getOwned,
      {
        programId,
        ownerId: identity.subject,
      },
    )
    if (!program?.currentCommitSha)
      throw new Error('Program not found or has no commit')
    await ctx.runMutation(internal.quotas.consumeProjectCreation, {})
    const repo = await store.createRepo({
      id: crypto.randomUUID(),
      baseRepo: { id: program.repoId, sha: program.currentCommitSha },
    })
    try {
      return await ctx.runMutation(internal.program.create, {
        name: `${program.name.slice(0, 115)} copy`,
        repoId: repo.id,
        commitSha: program.currentCommitSha,
        ...(program.template ? { template: program.template } : {}),
      })
    } catch (reason) {
      try {
        await store.deleteRepo({ id: repo.id })
      } catch (cleanupError) {
        console.error(
          'Unable to clean up unregistered project copy',
          repo.id,
          cleanupError,
        )
      }
      throw reason
    }
  },
})

export const importSources = action({
  args: {
    name: v.string(),
    template: v.union(
      v.literal('vexcode'),
      v.literal('pros'),
      v.literal('ez-template'),
      v.literal('jar-template'),
    ),
    files: v.array(v.object({ path: v.string(), contents: v.string() })),
  },
  handler: async (ctx, args): Promise<Id<'program'>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')
    const name = args.name.trim()
    if (!name || name.length > 120)
      throw new Error('Name must contain 1 to 120 characters')
    validateSourceFiles(args.files)
    const user = await authComponent.getAuthUser(ctx)
    await ctx.runMutation(internal.quotas.consumeProjectCreation, {})
    const repo = await store.createRepo({ id: crypto.randomUUID() })
    try {
      const commit = repo.createCommit({
        targetBranch: repo.defaultBranch,
        commitMessage: 'Import project sources',
        author: { name: user.name, email: user.email },
      })
      for (const file of args.files)
        commit.addFileFromString(file.path, file.contents)
      const result = await commit.send()
      return await ctx.runMutation(internal.program.create, {
        name,
        repoId: repo.id,
        commitSha: result.commitSha,
        template: args.template,
      })
    } catch (reason) {
      try {
        await store.deleteRepo({ id: repo.id })
      } catch (cleanupError) {
        console.error(
          'Unable to clean up unregistered source import',
          repo.id,
          cleanupError,
        )
      }
      throw reason
    }
  },
})

export const setStarred = mutation({
  args: { programId: v.id('program'), starred: v.boolean() },
  handler: async (ctx, { programId, starred }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')
    const program = await ctx.db.get('program', programId)
    if (!program || program.ownerId !== identity.subject || program.deleting)
      throw new Error('Program not found')
    await ctx.db.patch('program', programId, { starred })
    return null
  },
})
