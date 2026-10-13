import {
  validSimulatorManifest,
  decodeSimulatorProgram,
  type SimulatorHandoffManifest,
} from "@v5x/simulator"
export type { SimulatorHandoffManifest } from "@v5x/simulator"

export interface SimulatorHandoff {
  manifest: SimulatorHandoffManifest
  bytes: Uint8Array
}

function parseEndpoint(value: string, trustedValue: string) {
  const endpoint = new URL(value)
  const trusted = new URL(trustedValue)
  const local =
    endpoint.protocol === "http:" &&
    (endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1")
  if (
    (!local &&
      (endpoint.protocol !== "https:" ||
        !endpoint.hostname.endsWith(".convex.site"))) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("Untrusted simulator handoff endpoint")
  if (
    endpoint.origin !== trusted.origin ||
    endpoint.pathname !== trusted.pathname ||
    trusted.search ||
    trusted.hash
  )
    throw new Error("Simulator handoff endpoint does not match Code")
  return endpoint
}

async function digest(bytes: Uint8Array) {
  const owned = bytes.slice()
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", owned.buffer)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")
}

export function parseHandoffFragment(
  fragment: string,
  trustedEndpoint: string,
) {
  const params = new URLSearchParams(fragment.replace(/^#/, ""))
  const token = params.get("v5x-handoff")
  const site = params.get("site")
  if (!token && !site) return null
  if (!token || !/^[a-f0-9]{64}$/.test(token) || !site)
    throw new Error("Invalid simulator handoff link")
  return { token, endpoint: parseEndpoint(site, trustedEndpoint) }
}

export async function receiveSimulatorHandoff(
  fragment: string,
  trustedEndpoint: string,
  fetcher: typeof fetch = fetch,
): Promise<SimulatorHandoff | null> {
  const handoff = parseHandoffFragment(fragment, trustedEndpoint)
  if (!handoff) return null

  const response = await fetcher(
    new URL("simulator-handoff/consume", handoff.endpoint),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${handoff.token}` },
    },
  )
  if (!response.ok)
    throw new Error(
      response.status === 410
        ? "Simulator handoff expired or was already used"
        : `Unable to receive simulator build (${response.status})`,
    )
  const encodedManifest = response.headers.get("X-V5X-Handoff-Manifest")
  if (!encodedManifest || !/^[A-Za-z0-9_-]+$/.test(encodedManifest))
    throw new Error("Simulator handoff manifest is missing")
  const binary = atob(
    encodedManifest.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (encodedManifest.length % 4)) % 4),
  )
  const manifestText = new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestText)
  } catch {
    throw new Error("Simulator handoff manifest is invalid")
  }
  if (!validSimulatorManifest(parsed))
    throw new Error("Unsupported or invalid simulator handoff manifest")
  const manifest = parsed
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (
    bytes.byteLength !== manifest.artifact.size ||
    (await digest(bytes)) !== manifest.artifact.sha256
  )
    throw new Error("Simulator binary failed its integrity check")
  const program = decodeSimulatorProgram(bytes)
  if ((manifest.format === "pros-v5-package") !== !!program.hot)
    throw new Error("Simulator package format does not match manifest")
  return { manifest, bytes }
}
