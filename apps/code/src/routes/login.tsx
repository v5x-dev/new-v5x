import { DetectiveIcon, GoogleLogoIcon } from '@phosphor-icons/react'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { safeReturnUrl } from '@v5x/auth'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Separator } from '~/components/ui/separator'
import { authClient } from '~/lib/auth-client'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } =>
    typeof search.returnTo === 'string' ? { returnTo: search.returnTo } : {},
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
