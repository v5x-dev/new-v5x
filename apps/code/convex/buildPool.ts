import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation } from './_generated/server'

// Each slot is either being filled under a five-minute lease or owns one
// ready machine. Taking it removes the row in the same transaction.
export const reserve = internalMutation({
  args: { template: v.string(), imageTag: v.string() },
  handler: async (ctx, args) => {
    const slot = await ctx.db
      .query('buildPool')
      .withIndex('by_template_and_imageTag', (q) =>
        q.eq('template', args.template).eq('imageTag', args.imageTag),
      )
      .unique()
    if (slot && slot.expiresAt > Date.now()) return null
    if (slot) {
      if (slot.machineId)
        await ctx.scheduler.runAfter(0, internal.programBuild.deleteMachine, {
          machineId: slot.machineId,
        })
      await ctx.db.delete('buildPool', slot._id)
    }
    const lease = crypto.randomUUID()
    await ctx.db.insert('buildPool', {
      ...args,
      lease,
      expiresAt: Date.now() + 300_000,
    })
    return lease
  },
})

export const publish = internalMutation({
  args: {
    template: v.string(),
    imageTag: v.string(),
    lease: v.string(),
    machineId: v.string(),
    commitSha: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const slot = await ctx.db
      .query('buildPool')
      .withIndex('by_template_and_imageTag', (q) =>
        q.eq('template', args.template).eq('imageTag', args.imageTag),
      )
      .unique()
    if (!slot || slot.lease !== args.lease) return false
    await ctx.db.patch('buildPool', slot._id, {
      machineId: args.machineId,
      commitSha: args.commitSha,
      expiresAt: args.expiresAt,
    })
    return true
  },
})

export const take = internalMutation({
  args: { template: v.string(), imageTag: v.string() },
  handler: async (ctx, args) => {
    const slot = await ctx.db
      .query('buildPool')
      .withIndex('by_template_and_imageTag', (q) =>
        q.eq('template', args.template).eq('imageTag', args.imageTag),
      )
      .unique()
    if (!slot?.machineId || !slot.commitSha) return null
    await ctx.db.delete('buildPool', slot._id)
    await ctx.scheduler.runAfter(0, internal.buildPoolWorker.replenish, {})
    if (slot.expiresAt <= Date.now()) {
      await ctx.scheduler.runAfter(0, internal.programBuild.deleteMachine, {
        machineId: slot.machineId,
      })
      return null
    }
    return {
      machineId: slot.machineId,
      commitSha: slot.commitSha,
      expiresAt: slot.expiresAt,
    }
  },
})

export const release = internalMutation({
  args: { template: v.string(), imageTag: v.string(), lease: v.string() },
  handler: async (ctx, args) => {
    const slot = await ctx.db
      .query('buildPool')
      .withIndex('by_template_and_imageTag', (q) =>
        q.eq('template', args.template).eq('imageTag', args.imageTag),
      )
      .unique()
    if (slot?.lease === args.lease) await ctx.db.delete('buildPool', slot._id)
  },
})
