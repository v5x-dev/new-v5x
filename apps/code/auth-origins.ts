export {
  previewHostPattern,
  authPublicProtocol,
  isTrustedOrigin,
  sharedCookieDomain,
  trustedAuthOrigins,
  safeReturnUrl,
} from '@v5x/auth'

export const appHosts = [
  'code.v5x.dev',
  'localhost:3000',
  '127.0.0.1:3000',
  'k4xs74x6-3000.use.devtunnels.ms',
]

export function isAppHost(host: string) {
  return (
    appHosts.includes(host) ||
    /^v5x-code-[a-z0-9-]+-qainguins-projects\.vercel\.app$/.test(host)
  )
}
