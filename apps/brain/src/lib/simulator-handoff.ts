export interface SimulatorHandoffManifest {
  version: 1
  format: "vexcode-v5-raw"
  template: "vexcode"
  commitSha: string
  sourceSha256: string
  artifact: {
    path: "build/workspace.bin"
    size: number
    sha256: string
  }
}

export interface SimulatorHandoff {
  manifest: SimulatorHandoffManifest
  bytes: Uint8Array
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
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

function parseManifest(value: unknown): SimulatorHandoffManifest {
  if (!value || typeof value !== "object")
    throw new Error("Simulator handoff manifest is missing")
  const manifest = value as Partial<SimulatorHandoffManifest>
  if (
    manifest.version !== 1 ||
    manifest.format !== "vexcode-v5-raw" ||
    manifest.template !== "vexcode" ||
    typeof manifest.commitSha !== "string" ||
    !manifest.commitSha ||
    manifest.commitSha.length > 128 ||
    !validHash(manifest.sourceSha256) ||
    !manifest.artifact ||
    manifest.artifact.path !== "build/workspace.bin" ||
    !Number.isSafeInteger(manifest.artifact.size) ||
    manifest.artifact.size < 1 ||
    manifest.artifact.size > 32 * 1024 * 1024 ||
    !validHash(manifest.artifact.sha256)
  )
    throw new Error("Unsupported or invalid simulator handoff manifest")
  return manifest as SimulatorHandoffManifest
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
  const manifest = parseManifest(parsed)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (
    bytes.byteLength !== manifest.artifact.size ||
    (await digest(bytes)) !== manifest.artifact.sha256
  )
    throw new Error("Simulator binary failed its integrity check")
  return { manifest, bytes }
}
