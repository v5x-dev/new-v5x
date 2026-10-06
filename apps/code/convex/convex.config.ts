import { defineApp } from 'convex/server'
import { v } from 'convex/values'
import betterAuth from '@convex-dev/better-auth/convex.config'

const app = defineApp({
  env: {
    SMOL_CLOUD_TOKEN: v.optional(v.string()),
    SMOL_CLOUD_URL: v.optional(v.string()),
    VEXCODE_IMAGE_TAG: v.optional(v.string()),
  },
})

app.use(betterAuth)

export default app
