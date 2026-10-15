import { describe, expect, test } from "bun:test"
import { finishSharedAuthResponse, sharedAuthPreflight } from "./http"
import {
  authPublicProtocol,
  authServiceOrigin,
  isTrustedOrigin,
  loginUrl,
  rewriteSetCookie,
  safeReturnUrl,
  sharedCookieDomain,
  sharedSetCookies,
} from "./origins"

describe("shared auth origins", () => {
  test("parent domain is limited to v5x.dev hosts", () => {
    expect(sharedCookieDomain("code.v5x.dev")).toBe(".v5x.dev")
    expect(sharedCookieDomain("v5x.dev")).toBe(".v5x.dev")
    expect(sharedCookieDomain("localhost:3000")).toBeUndefined()
    expect(
      sharedCookieDomain("v5x-code-main-qainguins-projects.vercel.app")
    ).toBeUndefined()
  })

  test("rewrites session cookies onto the parent domain and strips it elsewhere", () => {
    const issued =
      "__Secure-better-auth.session_token=abc; Path=/; HttpOnly; Secure; SameSite=Lax"

    expect(rewriteSetCookie(issued, "code.v5x.dev")).toBe(
      `${issued}; Domain=.v5x.dev`
    )
    expect(
      rewriteSetCookie(`${issued}; Domain=.v5x.dev`, "localhost:3000")
    ).toBe(issued)
    expect(
      rewriteSetCookie(
        "better-auth.session_token=; Max-Age=0; Domain=localhost",
        "design.v5x.dev"
      )
    ).toBe("better-auth.session_token=; Max-Age=0; Domain=.v5x.dev")
    expect(sharedSetCookies(issued, "code.v5x.dev")).toEqual([
      `${issued}; Domain=.v5x.dev`,
      "__Secure-better-auth.session_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    ])
    expect(authPublicProtocol("127.0.0.1:3000")).toBe("http")
    expect(authPublicProtocol("code.v5x.dev")).toBe("https")
  })

  test("sends sibling apps to the code app and keeps preview apps local", () => {
    expect(authServiceOrigin("https://design.v5x.dev/workspace")).toBe(
      "https://code.v5x.dev"
    )
    expect(authServiceOrigin("http://localhost:5173/")).toBe(
      "http://localhost:3000"
    )
    expect(authServiceOrigin("http://127.0.0.1:3001/")).toBe(
      "http://127.0.0.1:3000"
    )
    expect(
      authServiceOrigin(
        "https://v5x-code-main-qainguins-projects.vercel.app/login"
      )
    ).toBe("https://v5x-code-main-qainguins-projects.vercel.app")
  })

  test("login links carry a trusted return target", () => {
    expect(loginUrl("https://brain.v5x.dev/sim")).toBe(
      "https://code.v5x.dev/login?returnTo=https%3A%2F%2Fbrain.v5x.dev%2Fsim"
    )
    expect(loginUrl("https://code.v5x.dev/projects")).toBe(
      "https://code.v5x.dev/login"
    )
  })

  test("rejects return targets outside the product origins", () => {
    expect(isTrustedOrigin("https://design.v5x.dev")).toBe(true)
    expect(isTrustedOrigin("http://localhost:5174")).toBe(true)
    expect(isTrustedOrigin("https://evil.example")).toBe(false)
    expect(
      safeReturnUrl("https://design.v5x.dev/a?b=1", "https://code.v5x.dev/")
    ).toBe("https://design.v5x.dev/a?b=1")
    expect(
      safeReturnUrl("https://evil.example/phish", "https://code.v5x.dev/")
    ).toBe("https://code.v5x.dev/")
    expect(safeReturnUrl("javascript:alert(1)", "https://code.v5x.dev/")).toBe(
      "https://code.v5x.dev/"
    )
    expect(
      safeReturnUrl("https://code.v5x.dev/login", "https://code.v5x.dev/")
    ).toBe("https://code.v5x.dev/")
    expect(
      safeReturnUrl("http://localhost:3001/", "https://code.v5x.dev/")
    ).toBe("https://code.v5x.dev/")
  })

  test("preflight and session responses allow credentialed sibling origins", async () => {
    const preflight = sharedAuthPreflight(
      new Request("https://code.v5x.dev/api/auth/get-session", {
        method: "OPTIONS",
        headers: { origin: "https://design.v5x.dev" },
      })
    )

    expect(preflight?.status).toBe(204)
    expect(preflight?.headers.get("access-control-allow-origin")).toBe(
      "https://design.v5x.dev"
    )
    expect(preflight?.headers.get("access-control-allow-credentials")).toBe(
      "true"
    )

    const denied = sharedAuthPreflight(
      new Request("https://code.v5x.dev/api/auth/get-session", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      })
    )
    expect(denied?.status).toBe(403)

    const finished = finishSharedAuthResponse(
      new Request("https://code.v5x.dev/api/auth/get-session", {
        headers: { origin: "https://brain.v5x.dev" },
      }),
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "set-cookie":
            "better-auth.session_token=abc; Path=/; HttpOnly; SameSite=Lax",
        },
      }),
      "code.v5x.dev"
    )

    expect(await finished.json()).toEqual({})
    expect(finished.headers.getSetCookie()).toEqual([
      "better-auth.session_token=abc; Path=/; HttpOnly; SameSite=Lax; Domain=.v5x.dev",
      "better-auth.session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    ])
    expect(finished.headers.get("access-control-allow-origin")).toBe(
      "https://brain.v5x.dev"
    )
  })
})
