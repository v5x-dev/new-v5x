import { DetectiveIcon, GoogleLogoIcon } from '@phosphor-icons/react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Separator } from '~/components/ui/separator'
import { authClient } from '~/lib/auth-client'

export const Route = createFileRoute('/login')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  return (
    <div className="w-screen h-screen grid place-items-center">
      <Card className="min-w-2xs">
        <CardHeader>
          <CardTitle className="text-center">code (by v5x)</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="flex flex-col gap-1">
          <Button
            onClick={async () => {
              const { error } = await authClient.signIn.social({
                provider: 'google',
                callbackURL: `${window.location.origin}/`,
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
              if (!error) navigate({ to: '/' })
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
