import type { ProjectSnapshot } from '~/components/ide/workspace-editor'

export interface SimulatorHandoffManifest {
  version: 1
  format: 'vexcode-v5-raw'
  template: 'vexcode'
  commitSha: string
  sourceSha256: string
  artifact: {
    path: 'build/workspace.bin'
    size: number
    sha256: string
  }
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

async function sha256(bytes: ArrayBuffer) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

export async function createSimulatorHandoffManifest(
  snapshot: ProjectSnapshot,
  binary: Uint8Array,
): Promise<SimulatorHandoffManifest> {
  if (
    !snapshot.commitSha ||
    !binary.byteLength ||
    binary.byteLength > 32 * 1024 * 1024
  )
    throw new Error(
      'The current build is missing or too large for the simulator.',
    )

  const sources = Object.entries(snapshot.files).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  const sourceBytes = new TextEncoder().encode(JSON.stringify(sources))
  return {
    version: 1,
    format: 'vexcode-v5-raw',
    template: 'vexcode',
    commitSha: snapshot.commitSha,
    sourceSha256: await sha256(sourceBytes.slice().buffer as ArrayBuffer),
    artifact: {
      path: 'build/workspace.bin',
      size: binary.byteLength,
      sha256: await sha256(binary.slice().buffer as ArrayBuffer),
    },
  }
}
