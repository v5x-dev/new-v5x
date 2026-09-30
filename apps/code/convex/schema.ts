import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The schema is entirely optional.
// You can delete this file (schema.ts) and the
// app will continue to work.
// The schema provides more precise TypeScript types.
export default defineSchema({
  program: defineTable({
    name: v.string(),
    repoId: v.string(),
    ownerId: v.string(),
    template: v.optional(
      v.union(v.literal('vexcode'), v.literal('pros'), v.literal('ez-template')),
    ),
  }).index('by_owner', ['ownerId'])
});
