import { HOUR, RateLimiter } from '@convex-dev/rate-limiter'
import { ConvexError } from 'convex/values'
import { components } from './_generated/api'
import { internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  projectCreation: { kind: 'token bucket', rate: 5, period: HOUR, capacity: 3 },
  projectCreationGlobal: {
    kind: 'token bucket',
    rate: 200,
    period: HOUR,
    capacity: 20,
  },
  feedback: { kind: 'token bucket', rate: 10, period: HOUR, capacity: 3 },
  feedbackGlobal: {
    kind: 'token bucket',
    rate: 100,
    period: HOUR,
    capacity: 20,
  },
})

export async function consumeQuota(
  ctx: MutationCtx,
  operation: 'projectCreation' | 'feedback',
) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new ConvexError('Sign in to continue.')
  for (const [name, key] of [
    [operation, identity.tokenIdentifier],
    [`${operation}Global`, undefined],
  ] as const) {
    const result = await rateLimiter.limit(ctx, name, { key })
    if (!result.ok) {
      throw new ConvexError(
        `Too many requests. Try again in ${Math.max(1, Math.ceil((result.retryAfter ?? HOUR) / 1000))} seconds.`,
      )
    }
  }
}

// This commits quota consumption before an action allocates a storage repository.
// Failed external storage requests also count toward the allocation limit.
export const consumeProjectCreation = internalMutation({
  args: {},
  handler: async (ctx) => {
    await consumeQuota(ctx, 'projectCreation')
    return null
  },
})
