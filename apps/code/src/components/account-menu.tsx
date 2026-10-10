import { ChatCircleIcon, SignOutIcon } from '@phosphor-icons/react'
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
  const { data: session } = authClient.useSession()
  const user = session?.user
  const userName = user?.name || user?.email || 'Guest'

  const initials = userName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  async function signOut() {
    setIsSigningOut(true)
    onError?.(null)

    try {
      const { error } = await authClient.signOut()
      if (error) throw new Error(error.message)
      window.location.assign('/login')
    } catch {
      onError?.('Unable to sign out. Try again.')
      setIsSigningOut(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              ref={triggerRef}
              variant="ghost"
              size={showName ? 'sm' : 'icon-sm'}
              className={showName ? 'min-w-0 justify-start' : undefined}
              aria-label="Account menu"
              title={userName}
            />
          }
        >
          <Avatar size="sm">
            <AvatarImage src={user?.image || undefined} alt="" />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          {showName && <span className="truncate">{userName}</span>}
        </DropdownMenuTrigger>
        <DropdownMenuContent side={side} align={align} className="min-w-40">
          <DropdownMenuGroup>
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
      <FeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        showTrigger={false}
        finalFocus={triggerRef}
      />
    </>
  )
}
