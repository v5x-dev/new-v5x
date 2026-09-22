import { betterAuth } from 'better-auth/minimal'
import { anonymous } from 'better-auth/plugins/anonymous'
import { createClient } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import type { GenericCtx } from '@convex-dev/better-auth'
import authConfig from './auth.config'
import { components } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { env, query } from './_generated/server'

const siteUrl = env.SITE_URL

export const authComponent = createClient<DataModel>(components.betterAuth)

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [convex({ authConfig }), anonymous()],
  })
}

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await authComponent.getAuthUser(ctx)
  },
})
