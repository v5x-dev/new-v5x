import { v } from 'convex/values'
import { internal } from './_generated/api'
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
    warmMachineId: v.optional(v.string()),
    warmImageTag: v.optional(v.string()),
    warmExpiresAt: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({ previousMachineId: v.union(v.null(), v.string()) }),
  ),
  handler: async (ctx, args) => {
    const program = await ctx.db.get('program', args.programId)
    if (!program || program.currentCommitSha !== args.commitSha) return null

    const cached = await ctx.db
      .query('programBuildCache')
      .withIndex('by_program', (q) => q.eq('programId', args.programId))
      .unique()

    if (cached) {
      for (const artifact of cached.artifacts) {
        await ctx.storage.delete(artifact.storageId)
      }

      await ctx.db.patch('programBuildCache', cached._id, {
        commitSha: args.commitSha,
        exitCode: args.exitCode,
        stdout: args.stdout,
        stderr: args.stderr,
        artifacts: args.artifacts,
        timings: args.timings,
        warmMachineId: args.warmMachineId,
        warmImageTag: args.warmImageTag,
        warmExpiresAt: args.warmExpiresAt,
      })
    } else {
      const { warmMachineId, warmImageTag, warmExpiresAt, ...buildCache } = args

      await ctx.db.insert('programBuildCache', {
        ...buildCache,
        ...(warmMachineId
          ? { warmMachineId, warmImageTag, warmExpiresAt }
          : {}),
      })
    }

    return { previousMachineId: cached?.warmMachineId ?? null }
  },
})

export const takeWarmMachine = internalMutation({
  args: {
    programId: v.id('program'),
    imageTag: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      machineId: v.string(),
      commitSha: v.string(),
      expiresAt: v.number(),
    }),
  ),
  handler: async (ctx, { programId, imageTag }) => {
    const cached = await ctx.db
      .query('programBuildCache')
      .withIndex('by_program', (q) => q.eq('programId', programId))
      .unique()

    if (!cached?.warmMachineId || cached.warmImageTag !== imageTag) {
      return null
    }

    const machineId = cached.warmMachineId
    await ctx.db.patch('programBuildCache', cached._id, {
      warmMachineId: undefined,
      warmImageTag: undefined,
      warmExpiresAt: undefined,
    })

    const expiresAt = cached.warmExpiresAt ?? 0
    if (expiresAt <= Date.now()) {
      await ctx.scheduler.runAfter(0, internal.programBuild.deleteMachine, {
        machineId,
      })
      return null
    }
    return { machineId, commitSha: cached.commitSha, expiresAt }
  },
})

export const getLatest = query({
  args: { programId: v.id('program'), commitSha: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      commitSha: v.string(),
      exitCode: v.number(),
      stdout: v.string(),
      stderr: v.string(),
      binFiles: v.array(v.string()),
      artifacts: v.array(v.object({ path: v.string(), url: v.string() })),
      timings: v.array(timingValidator),
    }),
  ),
  handler: async (ctx, { programId, commitSha }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const program = await ctx.db.get('program', programId)

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
      stdout: cached.stdout,
      stderr: cached.stderr,
      binFiles: cached.artifacts.map(({ path }) => path),
      artifacts: artifacts.filter((artifact) => artifact !== null),
      timings: cached.timings,
    }
  },
})
