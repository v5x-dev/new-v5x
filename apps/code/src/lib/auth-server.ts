import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start'
import { getToken as fetchToken } from '@convex-dev/better-auth/utils'
import { getRequestHeaders } from '@tanstack/react-start/server'

const convexSiteUrl = process.env.VITE_CONVEX_SITE_URL!

export const { fetchAuthQuery, fetchAuthMutation, fetchAuthAction } =
  convexBetterAuthReactStart({
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
  const url = new URL(request.url)
  const forwardedHost = headers.get('x-forwarded-host')

  const publicHost =
    forwardedHost &&
    [
      'code.v5x.dev',
      'localhost:3000',
      'k4xs74x6-3000.use.devtunnels.ms',
    ].includes(forwardedHost)
      ? forwardedHost
      : url.host

  const protocol = publicHost === 'localhost:3000' ? 'http' : 'https'
  headers.set('host', new URL(convexSiteUrl).host)
  headers.set('x-forwarded-host', publicHost)
  headers.set('x-forwarded-proto', protocol)
  headers.set('x-better-auth-forwarded-host', publicHost)
  headers.set('x-better-auth-forwarded-proto', protocol)

  return fetch(`${convexSiteUrl}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    redirect: 'manual',
    body: request.body,
    // Node fetch requires duplex when forwarding a streaming request body.
    // @ts-expect-error duplex is not included in the DOM RequestInit type.
    duplex: 'half',
  })
}

export async function getToken() {
  const { token } = await fetchToken(
    convexSiteUrl,
    authHeaders(new Headers(getRequestHeaders())),
  )

  return token
}
