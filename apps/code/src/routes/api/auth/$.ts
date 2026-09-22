import { createFileRoute } from '@tanstack/react-router'
import { handler, sanitizeAuthRequest } from '~/lib/auth-server'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }) => handler(await sanitizeAuthRequest(request)),
      POST: async ({ request }) => handler(await sanitizeAuthRequest(request)),
    },
  },
})
