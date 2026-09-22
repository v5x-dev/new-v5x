import { DetectiveIcon } from '@phosphor-icons/react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { authClient } from '~/lib/auth-client'

export const Route = createFileRoute('/login')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()

  return (
    <div className="grid place-items-center w-screen h-screen">
      <Card>
        <CardHeader className="flex flex-row justify-center text-center">
          <CardTitle>code (by v5x)</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={async () => {
              await authClient.signIn.anonymous()
              navigate({ to: '/' })
            }}
          >
            <DetectiveIcon />
            Sign in anonymously
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
