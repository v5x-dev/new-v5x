import { createAuthClient } from 'better-auth/react'
import { anonymousClient } from 'better-auth/client/plugins'
import { convexClient } from '@convex-dev/better-auth/client/plugins'
import type { AuthClient } from '@convex-dev/better-auth/react'

export const authClient = createAuthClient({
  plugins: [convexClient(), anonymousClient()],
}) as unknown as AuthClient
