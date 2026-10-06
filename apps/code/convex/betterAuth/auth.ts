import { betterAuth } from 'better-auth/minimal'
import { createClient } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import authConfig from '../auth.config'
import { components } from '../_generated/api'
import { query } from '../_generated/server'
import type { GenericCtx } from '@convex-dev/better-auth'
import type { DataModel } from '../_generated/dataModel'
import { anonymous } from 'better-auth/plugins'

const siteUrl = process.env.SITE_URL!
const isProductionSite = new URL(siteUrl).hostname === 'code.v5x.dev'
const googleClientId = process.env.GOOGLE_CLIENT_ID!
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET!

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
export const authComponent = createClient<DataModel>(components.betterAuth)

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    // Production has one canonical origin. Only development needs request-based
    // origins so OAuth can return to localhost or the development tunnel.
    baseURL: isProductionSite
      ? siteUrl
      : {
          allowedHosts: [
            new URL(siteUrl).host,
            'code.v5x.dev',
            'localhost:3000',
            'k4xs74x6-3000.use.devtunnels.ms',
          ],
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
      anonymous(),
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
