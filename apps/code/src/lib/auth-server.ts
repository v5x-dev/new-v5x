import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start'
import { getToken as fetchToken } from '@convex-dev/better-auth/utils'

const convexSiteUrl = process.env.VITE_CONVEX_SITE_URL!

const HOP_BY_HOP_HEADERS = [
  'connection',
  'content-length',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const

export function stripHopByHopHeaders(headers: Headers) {
  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header)
  }

  return headers
}

export async function sanitizeAuthRequest(request: Request) {
  const method = request.method.toUpperCase()
  const body =
    method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer()

  return new Request(request.url, {
    method: request.method,
    headers: stripHopByHopHeaders(new Headers(request.headers)),
    body,
  })
}

export const {
  handler,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = convexBetterAuthReactStart({
  convexUrl: process.env.VITE_CONVEX_URL!,
  convexSiteUrl,
})

export async function getToken() {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const headers = stripHopByHopHeaders(new Headers(getRequestHeaders()))

  // These HTTP/1 hop-by-hop headers are invalid when Undici negotiates HTTP/2
  // with the Convex site endpoint.
  headers.set('accept-encoding', 'identity')

  return (await fetchToken(convexSiteUrl, headers)).token
}
