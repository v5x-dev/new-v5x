import { betterAuth } from 'better-auth/minimal'
import { createClient } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import authConfig from '../auth.config'
import { components, internal } from '../_generated/api'
import { query } from '../_generated/server'
import type { GenericCtx } from '@convex-dev/better-auth'
import type { DataModel } from '../_generated/dataModel'
import { anonymous } from 'better-auth/plugins'
import { appHosts, previewHostPattern } from '../../auth-origins'

const siteUrl = process.env.SITE_URL!

const googleClientId = process.env.GOOGLE_CLIENT_ID!

const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET!

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
export const authComponent = createClient<DataModel>(components.betterAuth)

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    // Preview requests must keep their own origin for cookies and redirects.
    baseURL: {
      allowedHosts: [new URL(siteUrl).host, ...appHosts, previewHostPattern],
      fallback: siteUrl,
    },
    advanced: {
      trustedProxyHeaders: true,
      // Convex does not provide Node's production environment. Keep cookie names
      // and Secure attributes stable instead of inferring them from NODE_ENV.
      useSecureCookies: new URL(siteUrl).protocol === 'https:',
    },
    trustedOrigins: [
      new URL(siteUrl).origin,
      'https://code.v5x.dev',
      'http://localhost:3000',
      'https://k4xs74x6-3000.use.devtunnels.ms',
      `https://${previewHostPattern}`,
    ],
    database: authComponent.adapter(ctx),
    // Configure simple, non-verified email/password to get started
    socialProviders: {
      google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
      },
    },
    plugins: [
      // The Convex plugin is required for Convex compatibility
      convex({ authConfig }),
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          if (!anonymousUser.user.isAnonymous || newUser.user.isAnonymous)
            return
          if (!('runMutation' in ctx))
            throw new Error(
              'Account linking requires a writable backend context',
            )
          await ctx.runMutation(internal.program.transferGuestPrograms, {
            guestId: anonymousUser.user.id,
            accountId: newUser.user.id,
          })
        },
      }),
    ],
  })
}

// Example function for getting the current user
// Feel free to edit, omit, etc.
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await authComponent.getAuthUser(ctx)
  },
})
