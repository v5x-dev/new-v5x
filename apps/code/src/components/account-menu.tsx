import {
  ChatCircleIcon,
  GoogleLogoIcon,
  SignOutIcon,
} from '@phosphor-icons/react'
import * as React from 'react'
import { FeedbackDialog } from '~/components/feedback-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Skeleton } from '~/components/ui/skeleton'
import { authClient } from '~/lib/auth-client'

export function AccountMenu({
  side,
  align = 'end',
  showName = false,
  onError,
}: {
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  showName?: boolean
  onError?: (message: string | null) => void
}) {
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const [feedbackOpen, setFeedbackOpen] = React.useState(false)
  const [isSigningOut, setIsSigningOut] = React.useState(false)
  const [isLinking, setIsLinking] = React.useState(false)
  const [accountError, setAccountError] = React.useState<string | null>(null)
  const { data: session, isPending } = authClient.useSession()
  const user = session?.user
  const userName = user?.name || user?.email || 'Guest'

  const initials = userName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  function reportError(message: string | null) {
    if (onError) {
      onError(message)
    } else {
      setAccountError(message)
    }
  }

  async function signOut() {
    setIsSigningOut(true)
    reportError(null)

    try {
      const { error } = await authClient.signOut()
      if (error) throw new Error(error.message)
      window.location.assign('/login')
    } catch {
      reportError('Unable to sign out. Try again.')
      setIsSigningOut(false)
    }
  }

  async function keepProjects() {
    setIsLinking(true)
    reportError(null)
    try {
      const { error } = await authClient.signIn.social({
        provider: 'google',
        callbackURL: window.location.href,
      })
      if (error) throw new Error(error.message)
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : 'Unable to connect your account. Try again.'
      reportError(message)
      setIsLinking(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={isPending}
          render={
            <Button
              ref={triggerRef}
              variant="ghost"
              size={showName ? 'sm' : 'icon-sm'}
              className={
                showName
                  ? 'w-full min-w-0 justify-start overflow-hidden h-9 gap-2'
                  : undefined
              }
              aria-label="Account menu"
              aria-busy={isPending}
              title={isPending ? undefined : userName}
            />
          }
        >
          {isPending ? (
            <>
              <Skeleton
                aria-hidden="true"
                className="size-6 shrink-0 rounded-full"
              />
              {showName && (
                <Skeleton aria-hidden="true" className="h-4 w-28 min-w-0" />
              )}
            </>
          ) : (
            <Avatar size="sm">
              <AvatarImage src={user?.image || undefined} alt="" />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          )}
          {showName && !isPending && (
            <span className="min-w-0 flex-1 truncate text-left">
              {userName}
            </span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side={side} align={align} className="min-w-40">
          <DropdownMenuGroup>
            {user?.isAnonymous && (
              <DropdownMenuItem
                disabled={isLinking}
                onClick={() => void keepProjects()}
              >
                <GoogleLogoIcon />
                {isLinking ? 'Connecting...' : 'Keep my projects with Google'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setFeedbackOpen(true)}>
              <ChatCircleIcon />
              Feedback
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isSigningOut}
              onClick={() => void signOut()}
            >
              <SignOutIcon />
              {isSigningOut ? 'Logging out...' : 'Log out'}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {accountError && (
        <p role="alert" className="text-destructive text-sm">
          {accountError}
        </p>
      )}
      <FeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        showTrigger={false}
        finalFocus={triggerRef}
      />
    </>
  )
}
