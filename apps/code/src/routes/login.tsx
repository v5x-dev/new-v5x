import { DetectiveIcon, GoogleLogoIcon } from '@phosphor-icons/react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { safeReturnUrl } from '@v5x/auth'
import { Button } from '@v5x/ui/components/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@v5x/ui/components/card'
import { Separator } from '@v5x/ui/components/separator'
import { authClient } from '~/lib/auth-client'

const isProductionCodeHost = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const headers = getRequestHeaders()
    const host = (headers.get('x-forwarded-host') ?? headers.get('host') ?? '')
      .split(',')[0]
      ?.trim()
      .toLowerCase()
    return host === 'code.v5x.dev'
  },
)

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } =>
    typeof search.returnTo === 'string' ? { returnTo: search.returnTo } : {},
  beforeLoad: async ({ search }) => {
    const onProductionCode =
      typeof window !== 'undefined'
        ? window.location.hostname === 'code.v5x.dev'
        : await isProductionCodeHost()

    if (!onProductionCode) return

    const url = new URL('https://v5x.dev/login')
    url.searchParams.set('returnTo', search.returnTo ?? 'https://code.v5x.dev/')
    throw redirect({ href: url.toString() })
  },
  component: RouteComponent,
})

function RouteComponent() {
  const { returnTo } = Route.useSearch()
  const { data: session, isPending } = authClient.useSession()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  function destination() {
    return safeReturnUrl(returnTo, `${window.location.origin}/`)
  }

  useEffect(() => {
    if (isPending || !session || session.user.isAnonymous) return
    window.location.assign(destination())
  }, [isPending, session, returnTo])

  return (
    <div className="w-screen h-screen grid place-items-center">
      <Card className="min-w-2xs">
        <CardHeader>
          <CardTitle className="text-center">v5x</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="flex flex-col gap-1">
          <Button
            onClick={async () => {
              const { error } = await authClient.signIn.social({
                provider: 'google',
                callbackURL: destination(),
              })

              setErrorMessage(error?.message ?? null)
            }}
          >
            <GoogleLogoIcon />
            Sign in with Google
          </Button>
          <span className="text-muted-foreground text-center">or</span>
          <Button
            variant="outline"
            onClick={async () => {
              const { error } = await authClient.signIn.anonymous()

              setErrorMessage(error?.message ?? null)
              if (!error) window.location.assign(destination())
            }}
          >
            <DetectiveIcon />
            Sign in anonymously
          </Button>
          {errorMessage && (
            <p className="text-destructive text-center text-sm" role="alert">
              {errorMessage}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
