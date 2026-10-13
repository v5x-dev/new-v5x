/// <reference types="bun" />
import { expect, test } from "bun:test"
import {
  parseHandoffFragment,
  receiveSimulatorHandoff,
} from "./simulator-handoff"

const token = "a".repeat(64)

test("accepts only the Code handoff URL shape and trusted Convex endpoints", () => {
  expect(
    parseHandoffFragment(
      `#v5x-handoff=${token}&site=${encodeURIComponent("https://v5x-dev.convex.site")}`,
      "https://v5x-dev.convex.site",
    ),
  ).toMatchObject({ token })
  expect(() =>
    parseHandoffFragment(
      `#v5x-handoff=${token}&site=${encodeURIComponent("https://attacker.example")}`,
      "https://v5x-dev.convex.site",
    ),
  ).toThrow("Untrusted")
  expect(() =>
    parseHandoffFragment(
      `#v5x-handoff=${token}`,
      "https://v5x-dev.convex.site",
    ),
  ).toThrow("Invalid simulator handoff link")
  expect(
    parseHandoffFragment("#ordinary=anchor", "https://v5x-dev.convex.site"),
  ).toBeNull()
})

test("checks the manifest and binary digest before returning program bytes", async () => {
  const bytes = new Uint8Array([1, 2, 3])
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")
  const manifest = {
    version: 1 as const,
    format: "vexcode-v5-raw" as const,
    template: "vexcode" as const,
    commitSha: "commit-1",
    sourceSha256: "b".repeat(64),
    artifact: {
      path: "build/workspace.bin" as const,
      size: bytes.byteLength,
      sha256: digest,
    },
  }
  const encoded = btoa(JSON.stringify(manifest))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = []
  let nextResponse = new Response(bytes, {
    headers: { "X-V5X-Handoff-Manifest": encoded },
  })
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([input, init])
    return nextResponse
  }) as typeof fetch
  const result = await receiveSimulatorHandoff(
    `#v5x-handoff=${token}&site=${encodeURIComponent("https://v5x-dev.convex.site")}`,
    "https://v5x-dev.convex.site",
    fetcher,
  )
  expect(result?.manifest).toEqual(manifest)
  expect(result?.bytes).toEqual(bytes)
  expect(calls[0]).toEqual([
    new URL("https://v5x-dev.convex.site/simulator-handoff/consume"),
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  ])

  nextResponse = new Response(new Uint8Array([9, 9, 9]), {
    headers: { "X-V5X-Handoff-Manifest": encoded },
  })
  await expect(
    receiveSimulatorHandoff(
      `#v5x-handoff=${token}&site=${encodeURIComponent("https://v5x-dev.convex.site")}`,
      "https://v5x-dev.convex.site",
      fetcher,
    ),
  ).rejects.toThrow("integrity check")
})
