import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  program: defineTable({
    name: v.string(),
    repoId: v.string(),
    ownerId: v.string(),
  }).index('by_owner', ['ownerId']),
  programSession: defineTable({
    programId: v.id('program'),
    ownerId: v.string(),
    branch: v.string(),
    headSha: v.string(),
    baseSha: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_program', ['programId']),
})
