import { useEffect, useState } from "react"
import {
  getSharedSession,
  loginUrl,
  signOutShared,
  type SharedUser,
} from "@v5x/auth/browser"
import { Button, buttonVariants } from "@v5x/ui/components/button"

export function AccountLink() {
  const [user, setUser] = useState<SharedUser | null>(null)
  const [ready, setReady] = useState(false)
  const href =
    typeof window === "undefined"
      ? "https://v5x.dev/login"
      : loginUrl(window.location.href)

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

  if (!ready) {
    return (
      <Button variant="outline" size="sm" disabled>
        Sign in
      </Button>
    )
  }

  if (user) {
    const label = user.name || user.email || "Account"

    return (
      <Button
        variant="outline"
        size="sm"
        aria-label={`Sign out ${label}`}
        title="Sign out"
        onClick={() => {
          void signOutShared().finally(() => window.location.reload())
        }}
      >
        {label}
      </Button>
    )
  }

  return (
    <a
      href={href}
      className={buttonVariants({ variant: "outline", size: "sm" })}
    >
      Sign in
    </a>
  )
}
