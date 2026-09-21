// convex/schema.ts
import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export const frameworkType = v.union(
  v.literal("vexcode"),
  v.literal("pros"),
  v.literal("ez")
)

export default defineSchema({
  programs: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    framework: frameworkType,
    brainSlot: v.number(), // Target slot on V5 Brain (1-8)
    isPublic: v.boolean(),
    lastOpenedAt: v.number(),
  }).index("by_public", ["isPublic"]),

  programFiles: defineTable({
    programId: v.id("programs"),
    path: v.string(), // e.g., "src/main.cpp", "include/robot-config.h"
    name: v.string(),
    content: v.string(),
    isReadonly: v.boolean(),
    parentFolder: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_program", ["programId"])
    .index("by_program_and_path", ["programId", "path"]),
})
