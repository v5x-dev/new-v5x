import {
  getSharedSession,
  loginUrl,
  signOutShared,
  type SharedUser,
} from "@v5x/auth/browser"
import { useEffect, useState } from "react"
import { Button, buttonVariants } from "~/components/ui/button"

const href = loginUrl(window.location.href)

export function AccountLink() {
  const [user, setUser] = useState<SharedUser | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    void getSharedSession()
      .then((session) => {
        if (active) setUser(session)
      })
      .catch(() => {
        if (active) setUser(null)
      })
      .finally(() => {
        if (active) setReady(true)
      })
    return () => {
      active = false
    }
  }, [])

  if (ready && user) {
    const label = user.name || user.email || "Account"
    return (
      <Button
        variant="ghost"
        size="sm"
        title="Sign out"
        aria-label={`Sign out ${label}`}
        onClick={async () => {
          await signOutShared()
          location.reload()
        }}
      >
        {label}
      </Button>
    )
  }

  return (
    <a
      data-slot="button"
      className={buttonVariants({ variant: "ghost", size: "sm" })}
      href={ready ? href : undefined}
      aria-disabled={!ready}
      role={ready ? undefined : "link"}
      tabIndex={ready ? undefined : -1}
    >
      Sign in
    </a>
  )
}
