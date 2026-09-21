import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { frameworkType } from "./schema"
import { PROGRAM_TEMPLATES } from "./templates"

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("programs").collect()
  },
})

export const get = query({
  args: { programId: v.id("programs") },
  handler: async (ctx, { programId }) => {
    const program = await ctx.db.get(programId)

    if (!program) {
      return null
    }

    const storedFiles = await ctx.db
      .query("programFiles")
      .withIndex("by_program", (q) => q.eq("programId", programId))
      .collect()

    const files =
      storedFiles.length > 0
        ? storedFiles
        : PROGRAM_TEMPLATES[program.framework].map((file) => ({
            path: file.path,
            name: file.path.split("/").at(-1) ?? file.path,
            content: file.content,
            isReadonly: file.isReadonly ?? false,
            parentFolder: file.path.includes("/")
              ? file.path.slice(0, file.path.lastIndexOf("/"))
              : undefined,
          }))

    return { program, files }
  },
})

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    framework: frameworkType,
    brainSlot: v.optional(v.number()),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const programId = await ctx.db.insert("programs", {
      title: args.title,
      description: args.description,
      framework: args.framework,
      brainSlot: args.brainSlot ?? 1,
      isPublic: args.isPublic ?? true,
      lastOpenedAt: now,
    })

    await Promise.all(
      PROGRAM_TEMPLATES[args.framework].map((file) =>
        ctx.db.insert("programFiles", {
          programId,
          path: file.path,
          name: file.path.split("/").at(-1) ?? file.path,
          content: file.content,
          isReadonly: file.isReadonly ?? false,
          parentFolder: file.path.includes("/")
            ? file.path.slice(0, file.path.lastIndexOf("/"))
            : undefined,
          updatedAt: now,
        })
      )
    )

    return programId
  },
})
