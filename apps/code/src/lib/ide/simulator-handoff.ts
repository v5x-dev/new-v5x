import type { ProjectSnapshot } from './workspace'
import {
  encodeProsPackage,
  simulatorTemplate,
  type SimulatorHandoffManifest,
  type SimulatorTemplate,
} from '@v5x/simulator'
export type { SimulatorHandoffManifest } from '@v5x/simulator'

export function simulatorBinary(
  template: string,
  artifacts: ReadonlyMap<string, Uint8Array>,
) {
  if (!simulatorTemplate(template))
    throw new Error('This template cannot run in Brain.')
  if (template === 'vexcode') {
    const binary = artifacts.get('build/workspace.bin')
    if (!binary) throw new Error('Build the current committed source first.')
    return binary
  }
  const cold = artifacts.get('bin/cold.package.bin')
  const hot = artifacts.get('bin/hot.package.bin')
  if (!cold || !hot)
    throw new Error('Build both PROS hot and cold packages first.')
  return encodeProsPackage(cold, hot)
}

export function hasSimulatorArtifacts(
  template: string,
  artifacts: ReadonlyMap<string, Uint8Array>,
) {
  if (!simulatorTemplate(template)) return false
  if (template === 'vexcode') return artifacts.has('build/workspace.bin')
  return (
    artifacts.has('bin/hot.package.bin') &&
    artifacts.has('bin/cold.package.bin')
  )
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
  template: SimulatorTemplate = 'vexcode',
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
    format: template === 'vexcode' ? 'vexcode-v5-raw' : 'pros-v5-package',
    template,
    commitSha: snapshot.commitSha,
    sourceSha256: await sha256(sourceBytes.slice().buffer as ArrayBuffer),
    artifact: {
      path:
        template === 'vexcode' ? 'build/workspace.bin' : 'build/simulator.v5x',
      size: binary.byteLength,
      sha256: await sha256(binary.slice().buffer as ArrayBuffer),
    },
  }
}

export async function uploadSimulatorBinary(
  uploadUrl: string,
  binary: Uint8Array,
) {
  const upload = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Blob([binary.slice().buffer as ArrayBuffer]),
  })
  if (!upload.ok) throw new Error('Could not upload the simulator binary.')

  const uploaded: unknown = await upload.json()
  if (
    !uploaded ||
    typeof uploaded !== 'object' ||
    !('storageId' in uploaded) ||
    typeof uploaded.storageId !== 'string'
  )
    throw new Error('The artifact service returned an invalid storage ID.')

  return uploaded.storageId
}

const trustedBrainOrigins = new Set([
  'https://brain.v5x.dev',
  'http://localhost:5173',
  'http://localhost:3103',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3103',
])

export function brainSimulatorUrl(token: string, endpoint: string) {
  const defaultBrainUrl =
    location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:5173'
      : 'https://brain.v5x.dev'
  const url = new URL(import.meta.env.VITE_BRAIN_APP_URL || defaultBrainUrl)

  if (!trustedBrainOrigins.has(url.origin))
    throw new Error('The configured Brain simulator origin is not trusted.')

  url.hash = new URLSearchParams({
    'v5x-handoff': token,
    site: endpoint,
  }).toString()
  return url.href
}
