import type { ProjectSnapshot } from '~/components/ide/workspace-editor'

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
