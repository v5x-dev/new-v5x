import { v } from 'convex/values'
import { action, internalQuery, mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import boring from 'boring-name-generator'
import { store } from './store'
import { api, internal } from './_generated/api'
import { initializeTemplate } from './template'

export const createProgram = action({
  args: {
    name: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<'program'>> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')

    const repo = await store.createRepo({
      id: boring({ words: 2, number: true }).dashed,
    })
    await initializeTemplate(repo)

    const programId: Id<'program'> = await ctx.runMutation(api.program.create, {
      name: args.name || repo.id,
      repoId: repo.id,
    })

    return programId
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    repoId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')

    return await ctx.db.insert('program', {
      name: args.name,
      repoId: args.repoId,
      ownerId: identity.subject,
    })
  },
})

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')

    return await ctx.db
      .query('program')
      .withIndex('by_owner', (q) => q.eq('ownerId', identity.subject))
      .collect()
  },
})

export const get = query({
  args: {
    programId: v.id('program'),
  },
  handler: async (ctx, { programId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')

    const program = await ctx.db.get(programId)
    if (!program || program.ownerId !== identity.subject) return null

    return program
  },
})

export const getOwned = internalQuery({
  args: {
    programId: v.id('program'),
    ownerId: v.string(),
  },
  handler: async (ctx, { programId, ownerId }) => {
    const program = await ctx.db.get(programId)
    if (!program || program.ownerId !== ownerId) return null

    return program
  },
})

export const getProgramFiles = action({
  args: {
    programId: v.id('program'),
  },
  handler: async (ctx, { programId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')

    const program: Doc<'program'> | null = await ctx.runQuery(
      internal.program.getOwned,
      { programId, ownerId: identity.subject },
    )
    if (!program) throw new Error('Program not found')

    const repo = store.repo({ id: program.repoId })
    const paths: string[] = []
    let cursor: string | undefined
    let hasMore = true

    while (hasMore) {
      const page = await repo.listFiles({
        recursive: true,
        limit: 1000,
        cursor,
      })
      paths.push(...page.paths)
      cursor = page.nextCursor
      hasMore = page.hasMore
    }

    return paths
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
    const response = await repo.getFileStream({ path })
    if (!response.ok) throw new Error(`Unable to load ${path}`)

    return await response.text()
  },
})

export const saveProgramFile = action({
  args: {
    programId: v.id('program'),
    path: v.string(),
    contents: v.string(),
  },
  handler: async (ctx, { programId, path, contents }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')

    const program: Doc<'program'> | null = await ctx.runQuery(
      internal.program.getOwned,
      { programId, ownerId: identity.subject },
    )
    if (!program) throw new Error('Program not found')
    if (
      !path ||
      path.startsWith('/') ||
      path.includes('\\') ||
      path
        .split('/')
        .some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw new Error('Invalid file path')
    }

    const repo = store.repo({ id: program.repoId })
    await repo.headFile({ path })

    const commit = repo.createCommit({
      targetBranch: repo.defaultBranch,
      commitMessage: `Update ${path}`,
      author: {
        name: identity.name ?? 'v5x user',
        email: identity.email ?? 'v5x-user@users.noreply.v5x.dev',
      },
    })
    commit.addFileFromString(path, contents)

    await commit.send()
    return null
  },
})
