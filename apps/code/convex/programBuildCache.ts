import { v } from 'convex/values'
import { internalMutation, query } from './_generated/server'

const artifactValidator = v.object({
  path: v.string(),
  storageId: v.id('_storage'),
})
const timingValidator = v.object({ stage: v.string(), ms: v.number() })

export const cacheLatest = internalMutation({
  args: {
    programId: v.id('program'),
    commitSha: v.string(),
    exitCode: v.number(),
    stdout: v.string(),
    stderr: v.string(),
    artifacts: v.array(artifactValidator),
    timings: v.array(timingValidator),
  },
  handler: async (ctx, args) => {
    const program = await ctx.db.get(args.programId)
    if (!program || program.currentCommitSha !== args.commitSha) return false

    const cached = await ctx.db
      .query('programBuildCache')
      .withIndex('by_program', (q) => q.eq('programId', args.programId))
      .unique()

    if (cached) {
      for (const artifact of cached.artifacts) {
        await ctx.storage.delete(artifact.storageId)
      }
      await ctx.db.patch(cached._id, {
        commitSha: args.commitSha,
        exitCode: args.exitCode,
        stdout: args.stdout,
        stderr: args.stderr,
        artifacts: args.artifacts,
        timings: args.timings,
      })
    } else {
      await ctx.db.insert('programBuildCache', args)
    }

    return true
  },
})

export const getLatest = query({
  args: { programId: v.id('program'), commitSha: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      commitSha: v.string(),
      exitCode: v.number(),
      binFiles: v.array(v.string()),
      artifacts: v.array(v.object({ path: v.string(), url: v.string() })),
      timings: v.array(timingValidator),
    }),
  ),
  handler: async (ctx, { programId, commitSha }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const program = await ctx.db.get(programId)
    if (
      !program ||
      program.ownerId !== identity.subject ||
      program.currentCommitSha !== commitSha
    ) {
      return null
    }

    const cached = await ctx.db
      .query('programBuildCache')
      .withIndex('by_program', (q) => q.eq('programId', programId))
      .unique()
    if (!cached || cached.commitSha !== commitSha) return null

    const artifacts = await Promise.all(
      cached.artifacts.map(async ({ path, storageId }) => {
        const url = await ctx.storage.getUrl(storageId)
        return url === null ? null : { path, url }
      }),
    )

    return {
      commitSha: cached.commitSha,
      exitCode: cached.exitCode,
      binFiles: cached.artifacts.map(({ path }) => path),
      artifacts: artifacts.filter((artifact) => artifact !== null),
      timings: cached.timings,
    }
  },
})
