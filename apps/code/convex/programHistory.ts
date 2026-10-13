import { v } from 'convex/values'
import { action } from './_generated/server'
import { internal } from './_generated/api'
import { store } from './store'
import { authComponent } from './betterAuth/auth'
import type { ActionCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

async function ownedProgram(
  ctx: ActionCtx,
  programId: Id<'program'>,
): Promise<Doc<'program'> & { currentCommitSha: string }> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error('Unauthorized')
  const program: Doc<'program'> | null = await ctx.runQuery(
    internal.program.getOwned,
    { programId, ownerId: identity.subject },
  )
  if (!program?.currentCommitSha)
    throw new Error('Program not found or has no commit')
  return program as Doc<'program'> & { currentCommitSha: string }
}

export const list = action({
  args: { programId: v.id('program'), cursor: v.optional(v.string()) },
  handler: async (ctx, { programId, cursor }) => {
    const program = await ownedProgram(ctx, programId)
    const repo = store.repo({ id: program.repoId })
    const result = await repo.listCommits({
      branch: program.currentCommitSha,
      limit: 30,
      cursor,
    })
    return {
      head: program.currentCommitSha,
      commits: result.commits.map((commit) => ({
        sha: commit.sha,
        message: commit.message,
        author: commit.authorName,
        date: commit.date.toISOString(),
      })),
      cursor: result.hasMore ? (result.nextCursor ?? null) : null,
    }
  },
})

export const diff = action({
  args: { programId: v.id('program'), commitSha: v.string() },
  handler: async (ctx, { programId, commitSha }) => {
    const program = await ownedProgram(ctx, programId)
    const result = await store
      .repo({ id: program.repoId })
      .getCommitDiff({ sha: commitSha })
    if (
      result.files.length > 2000 ||
      result.files.reduce(
        (bytes, file) => bytes + new TextEncoder().encode(file.raw).byteLength,
        0,
      ) >
        8 * 1024 * 1024
    )
      throw new Error(
        'This diff exceeds the 8 MiB review limit. Export the sources to review locally.',
      )
    return {
      files: result.files.map((file) => ({ path: file.path, patch: file.raw })),
      omitted: result.filteredFiles.map((file) => file.path),
    }
  },
})

export const restore = action({
  args: {
    programId: v.id('program'),
    commitSha: v.string(),
    expectedCommitSha: v.string(),
  },
  handler: async (
    ctx,
    { programId, commitSha, expectedCommitSha },
  ): Promise<string> => {
    const program = await ownedProgram(ctx, programId)
    if (program.currentCommitSha !== expectedCommitSha)
      throw new Error('The project changed. Reload history before restoring.')
    const repo = store.repo({ id: program.repoId })
    await repo.getCommit({ sha: commitSha })
    const user = await authComponent.getAuthUser(ctx)
    const result = await repo.restoreCommit({
      targetBranch: repo.defaultBranch,
      targetCommitSha: commitSha,
      expectedHeadSha: expectedCommitSha,
      commitMessage: `Restore sources from ${commitSha.slice(0, 12)}`,
      author: { name: user.name, email: user.email },
    })
    await ctx.runMutation(internal.program.setCurrentCommitSha, {
      programId,
      commitSha: result.commitSha,
    })
    return result.commitSha
  },
})
