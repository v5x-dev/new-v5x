import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

// Keep this transaction separate from program.ts, whose repository/auth imports
// add cold-start work to every build. Authorization, the commit claim, and worker
// ownership all happen in one transaction.
export const acquire = internalMutation({
  args: {
    programId: v.id('program'),
    ownerId: v.string(),
    imageTag: v.string(),
  },
  handler: async (
    ctx,
    { programId, ownerId, imageTag },
  ): Promise<{
    program: Doc<'program'>
    commitSha: string
    warmBuild: {
      machineId: string
      commitSha: string
      expiresAt: number
      artifacts: Array<{
        path: string
        storageId: Id<'_storage'>
        sha256?: string
      }>
    } | null
  }> => {
    const program = await ctx.db.get('program', programId)
    if (!program || program.ownerId !== ownerId)
      throw new Error('Program not found')
    const commitSha = program.currentCommitSha
    if (!commitSha) throw new Error('Program commit is still loading')
    const existing = await ctx.db
      .query('programBuilds')
      .withIndex('by_program_commit', (q) =>
        q.eq('programId', programId).eq('commitSha', commitSha),
      )
      .unique()
    if (existing) throw new Error('This commit has already been built')
    await ctx.db.insert('programBuilds', { programId, commitSha })
    const warmBuild =
      (await ctx.runMutation(internal.programBuildCache.takeWarmMachine, {
        programId,
        imageTag,
      })) ??
      (await ctx.runMutation(internal.buildPool.take, {
        template: program.template ?? 'vexcode',
        imageTag,
      }))
    return { program, commitSha, warmBuild }
  },
})

export const release = internalMutation({
  args: { programId: v.id('program'), commitSha: v.string() },
  handler: async (ctx, { programId, commitSha }) => {
    const claim = await ctx.db
      .query('programBuilds')
      .withIndex('by_program_commit', (q) =>
        q.eq('programId', programId).eq('commitSha', commitSha),
      )
      .unique()
    if (claim) await ctx.db.delete('programBuilds', claim._id)
  },
})
