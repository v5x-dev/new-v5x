export const previewHostPattern = "v5x-code-*-qainguins-projects.vercel.app"

export const sharedProductionOrigins = [
  "https://v5x.dev",
  "https://code.v5x.dev",
  "https://brain.v5x.dev",
  "https://design.v5x.dev",
] as const

const tunnelOrigin = "https://k4xs74x6-3000.use.devtunnels.ms"

const previewOrigin =
  /^https:\/\/v5x-code-[a-z0-9-]+-qainguins-projects\.vercel\.app$/

const exactOrigins = new Set<string>([...sharedProductionOrigins, tunnelOrigin])

function isLocalOrigin(origin: string) {
  try {
    const url = new URL(origin)
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    )
  } catch {
    return false
  }
}

export function isTrustedOrigin(origin: string) {
  return (
    exactOrigins.has(origin) ||
    previewOrigin.test(origin) ||
    isLocalOrigin(origin)
  )
}

export function trustedAuthOrigins(siteUrl: string) {
  return [
    ...new Set([
      new URL(siteUrl).origin,
      ...sharedProductionOrigins,
      "http://localhost:*",
      "http://127.0.0.1:*",
      tunnelOrigin,
      `https://${previewHostPattern}`,
    ]),
  ]
}

// Host-only cookies already cover every port of one host. Sibling apps on
// v5x.dev need a parent domain so the code app's session is sent to them.
export function sharedCookieDomain(publicHost: string) {
  const hostname = publicHost.split(":")[0]?.toLowerCase() ?? ""
  if (hostname === "v5x.dev" || hostname.endsWith(".v5x.dev")) return ".v5x.dev"
  return undefined
}

function cookieParts(setCookie: string) {
  return setCookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

export function rewriteSetCookie(setCookie: string, publicHost: string) {
  const domain = sharedCookieDomain(publicHost)
  const parts = cookieParts(setCookie).filter((part) => !/^domain=/i.test(part))

  if (domain) parts.push(`Domain=${domain}`)
  return parts.join("; ")
}

// A previous sign-in stored a host-only cookie on code.v5x.dev. The shared
// cookie uses the parent domain, so both would be sent until the host-only
// one expires.
export function sharedSetCookies(setCookie: string, publicHost: string) {
  const rewritten = rewriteSetCookie(setCookie, publicHost)
  if (!sharedCookieDomain(publicHost)) return [rewritten]

  const parts = cookieParts(rewritten)
  const pair = parts[0] ?? ""
  const separator = pair.indexOf("=")
  const name = separator > 0 ? pair.slice(0, separator) : ""
  if (!name) return [rewritten]

  const attributes = parts
    .slice(1)
    .filter(
      (part) =>
        !/^domain=/i.test(part) &&
        !/^max-age=/i.test(part) &&
        !/^expires=/i.test(part)
    )

  return [rewritten, [name + "=", ...attributes, "Max-Age=0"].join("; ")]
}

export function authPublicProtocol(publicHost: string) {
  const hostname = publicHost.split(":")[0]?.toLowerCase() ?? ""
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http"
  return "https"
}

// Auth requests are served by the code app, which proxies them to Convex.
export function authServiceOrigin(pageUrl: string) {
  const page = new URL(pageUrl)
  const hostname = page.hostname.toLowerCase()

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${page.protocol}//${hostname}:3000`
  }

  if (hostname === "v5x.dev" || hostname.endsWith(".v5x.dev")) {
    return "https://code.v5x.dev"
  }

  return page.origin
}

export function loginUrl(pageUrl: string) {
  const service = authServiceOrigin(pageUrl)
  const url = new URL("/login", service)
  const page = new URL(pageUrl)

  if (page.origin !== new URL(service).origin) {
    url.searchParams.set("returnTo", page.href)
  }

  return url.toString()
}

export function safeReturnUrl(value: string | undefined, fallback: string) {
  if (!value) return fallback

  let fallbackUrl: URL
  try {
    fallbackUrl = new URL(fallback)
  } catch {
    return fallback
  }

  try {
    const url = new URL(value)
    if (url.username || url.password) return fallback
    if (url.protocol !== "https:" && url.protocol !== "http:") return fallback
    if (url.origin !== `${url.protocol}//${url.host}`) return fallback
    if (!isTrustedOrigin(url.origin)) return fallback
    if (isLocalOrigin(url.origin) && !isLocalOrigin(fallbackUrl.origin)) {
      return fallback
    }
    if (url.origin === fallbackUrl.origin && url.pathname === "/login") {
      return fallback
    }
    return url.toString()
  } catch {
    return fallback
  }
}
