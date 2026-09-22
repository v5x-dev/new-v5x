import { defineApp } from 'convex/server'
import { v } from 'convex/values'
import betterAuth from '@convex-dev/better-auth/convex.config'

const app = defineApp({
  env: {
    SITE_URL: v.string(),
  },
})
app.use(betterAuth)

export default app
