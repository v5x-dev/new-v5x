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
    ownerId: v.string()
  }).index('by_owner', ['ownerId'])
});
