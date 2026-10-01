import { v } from 'convex/values'
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import boring from 'boring-name-generator'
import { store } from './store'
import { api, internal } from './_generated/api'
import { initializeTemplate, type ProgramTemplate } from './template'
import { authComponent } from './betterAuth/auth'

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

    const repo = await store.createRepo({
      id: boring({ words: 2, number: true }).dashed,
    })
    const template: ProgramTemplate = args.template ?? 'vexcode'
    const initialCommit = await initializeTemplate(repo, template, {
      name: user.name,
      email: user.email,
    })

    const programId: Id<'program'> = await ctx.runMutation(api.program.create, {
      name: args.name || repo.id,
      repoId: repo.id,
      template,
      commitSha: initialCommit.commitSha,
    })

    return programId
  },
})

export const create = mutation({
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
  handler: async (ctx, { programId }): Promise<Doc<'program'> | null> => {
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

export const setCurrentCommitSha = internalMutation({
  args: {
    programId: v.id('program'),
    commitSha: v.string(),
  },
  handler: async (ctx, { programId, commitSha }) => {
    await ctx.db.patch(programId, { currentCommitSha: commitSha })
    return null
  },
})

export const hasRunForCommit = query({
  args: { programId: v.id('program'), commitSha: v.string() },
  handler: async (ctx, { programId, commitSha }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return false

    const program = await ctx.db.get(programId)
    if (!program || program.ownerId !== identity.subject) return false

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
  ): Promise<{ paths: string[]; commitSha: string }> => {
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
    const user = await authComponent.getAuthUser(ctx)

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
        name: user.name,
        email: user.email,
      },
    })
    commit.addFileFromString(path, contents)

    const result = await commit.send()
    await ctx.runMutation(internal.program.setCurrentCommitSha, {
      programId,
      commitSha: result.commitSha,
    })
    return result.commitSha
  },
})
