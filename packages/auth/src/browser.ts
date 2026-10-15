import { authServiceOrigin, loginUrl } from "./origins"

export type SharedUser = {
  id: string
  name: string
  email: string
  image?: string | null
  isAnonymous?: boolean | null
}

type SessionResponse = { user?: SharedUser | null } | null

export async function getSharedSession(pageUrl = location.href) {
  const endpoint = new URL("/api/auth/get-session", authServiceOrigin(pageUrl))
  const response = await fetch(endpoint, { credentials: "include" })
  if (!response.ok) return null

  const body = (await response.json()) as SessionResponse
  return body?.user ?? null
}

export async function signOutShared(pageUrl = location.href) {
  const endpoint = new URL("/api/auth/sign-out", authServiceOrigin(pageUrl))
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
  })

  if (!response.ok) throw new Error("Unable to sign out")
}

export function mountSharedAccount(element: Element | null) {
  if (!(element instanceof HTMLAnchorElement)) return

  element.href = loginUrl(location.href)

  void getSharedSession()
    .then((user) => {
      if (!user) return

      const label = user.name || user.email || "Account"
      element.textContent = label
      element.title = "Sign out"
      element.setAttribute("aria-label", `Sign out ${label}`)
      element.addEventListener("click", (event) => {
        event.preventDefault()
        void signOutShared().finally(() => location.reload())
      })
    })
    .catch(() => {
      element.href = loginUrl(location.href)
    })
}

export { loginUrl }
