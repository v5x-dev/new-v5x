import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

// The schema is entirely optional.
// You can delete this file (schema.ts) and the
// app will continue to work.
// The schema provides more precise TypeScript types.
export default defineSchema({
  feedback: defineTable({
    kind: v.union(v.literal('bug'), v.literal('feature')),
    title: v.string(),
    description: v.string(),
    reporterId: v.string(),
    reporterEmail: v.optional(v.string()),
  }),
  program: defineTable({
    name: v.string(),
    repoId: v.string(),
    ownerId: v.string(),
    archived: v.optional(v.boolean()),
    deleting: v.optional(v.boolean()),
    starred: v.optional(v.boolean()),
    currentCommitSha: v.optional(v.string()),
    template: v.optional(
      v.union(
        v.literal('vexcode'),
        v.literal('pros'),
        v.literal('ez-template'),
        v.literal('jar-template'),
      ),
    ),
  })
    .index('by_owner', ['ownerId'])
    .index('by_owner_and_archived', ['ownerId', 'archived'])
    .index('by_ownerId_and_archived_and_name', ['ownerId', 'archived', 'name']),
  buildPool: defineTable({
    template: v.string(),
    imageTag: v.string(),
    lease: v.string(),
    expiresAt: v.number(),
    machineId: v.optional(v.string()),
    commitSha: v.optional(v.string()),
  }).index('by_template_and_imageTag', ['template', 'imageTag']),
  programBuilds: defineTable({
    programId: v.id('program'),
    commitSha: v.string(),
  }).index('by_program_commit', ['programId', 'commitSha']),
  programBuildCache: defineTable({
    programId: v.id('program'),
    commitSha: v.string(),
    exitCode: v.number(),
    stdout: v.string(),
    stderr: v.string(),
    warmMachineId: v.optional(v.string()),
    warmImageTag: v.optional(v.string()),
    warmExpiresAt: v.optional(v.number()),
    artifacts: v.array(
      v.object({
        path: v.string(),
        storageId: v.id('_storage'),
        sha256: v.optional(v.string()),
      }),
    ),
    timings: v.array(v.object({ stage: v.string(), ms: v.number() })),
  }).index('by_program', ['programId']),
  simulatorHandoffs: defineTable({
    tokenHash: v.string(),
    ownerId: v.string(),
    programId: v.id('program'),
    commitSha: v.string(),
    sourceSha256: v.string(),
    artifactSha256: v.string(),
    artifactSize: v.number(),
    expiresAt: v.number(),
    storageId: v.optional(v.id('_storage')),
    consumedAt: v.optional(v.number()),
  })
    .index('by_token_hash', ['tokenHash'])
    .index('by_program', ['programId']),
})
