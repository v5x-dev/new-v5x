import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start'
import { getToken as fetchToken } from '@convex-dev/better-auth/utils'
import { getRequestHeaders } from '@tanstack/react-start/server'

const convexSiteUrl = process.env.VITE_CONVEX_SITE_URL!

export const {
  handler: authHandler,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = convexBetterAuthReactStart({
  convexUrl: process.env.VITE_CONVEX_URL!,
  convexSiteUrl,
})

function authHeaders(incoming: Headers) {
  const headers = new Headers(incoming)
  // Transport-specific headers must not be forwarded to Convex over HTTP/2.
  const connectionHeaders = headers.get('connection')?.split(',') ?? []
  for (const name of [
    ...connectionHeaders,
    'connection',
    'proxy-connection',
    'keep-alive',
    'transfer-encoding',
    'te',
    'trailer',
    'upgrade',
    'content-length',
  ]) {
    headers.delete(name.trim())
  }
  headers.set('accept-encoding', 'identity')
  return headers
}

export function handler(request: Request) {
  const headers = authHeaders(request.headers)
  for (const name of [...request.headers.keys()]) {
    if (!headers.has(name)) request.headers.delete(name)
  }
  request.headers.set('accept-encoding', 'identity')
  return authHandler(request)
}

export async function getToken() {
  const { token } = await fetchToken(
    convexSiteUrl,
    authHeaders(new Headers(getRequestHeaders())),
  )
  return token
}
