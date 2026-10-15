import { isTrustedOrigin, sharedSetCookies } from "./origins"

function corsHeaders(origin: string) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    vary: "origin",
  }
}

function setCookieValues(headers: Headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie()
  const single = headers.get("set-cookie")
  return single ? [single] : []
}

export function sharedAuthPreflight(request: Request) {
  if (request.method !== "OPTIONS") return null

  const origin = request.headers.get("origin")
  if (!origin || !isTrustedOrigin(origin)) {
    return new Response(null, { status: 403 })
  }

  return new Response(null, { status: 204, headers: corsHeaders(origin) })
}

export function finishSharedAuthResponse(
  request: Request,
  response: Response,
  publicHost: string
) {
  const headers = new Headers(response.headers)
  const cookies = setCookieValues(response.headers)

  if (cookies.length > 0) {
    headers.delete("set-cookie")
    for (const cookie of cookies) {
      for (const issued of sharedSetCookies(cookie, publicHost)) {
        headers.append("set-cookie", issued)
      }
    }
  }

  const origin = request.headers.get("origin")
  if (origin && isTrustedOrigin(origin)) {
    for (const [name, value] of Object.entries(corsHeaders(origin))) {
      headers.set(name, value)
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
