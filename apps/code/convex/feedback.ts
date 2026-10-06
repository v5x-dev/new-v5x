import { ConvexError, v } from 'convex/values'
import { mutation } from './_generated/server'
import { authComponent } from './betterAuth/auth'

export const submit = mutation({
  args: {
    kind: v.union(v.literal('bug'), v.literal('feature')),
    title: v.string(),
    description: v.string(),
  },
  returns: v.id('feedback'),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new ConvexError('Sign in to send feedback.')

    const title = args.title.trim()
    const description = args.description.trim()
    if (!title || title.length > 120) {
      throw new ConvexError('Enter a title of 1 to 120 characters.')
    }
    if (!description || description.length > 5000) {
      throw new ConvexError('Enter a description of 1 to 5,000 characters.')
    }

    const user = await authComponent.getAuthUser(ctx)
    return await ctx.db.insert('feedback', {
      kind: args.kind,
      title,
      description,
      reporterId: identity.tokenIdentifier,
      ...(user.isAnonymous ? {} : { reporterEmail: user.email }),
    })
  },
})
