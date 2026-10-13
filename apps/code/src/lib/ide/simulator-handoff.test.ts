import { describe, expect, test } from 'vitest'
import { createSimulatorHandoffManifest } from './simulator-handoff'

describe('simulator handoff manifest', () => {
  test('binds sorted committed sources and binary bytes to one manifest', async () => {
    const binary = new Uint8Array([1, 2, 3, 255])
    const manifest = await createSimulatorHandoffManifest(
      {
        commitSha: 'commit-1',
        files: { 'src/z.cpp': 'z', 'src/a.cpp': 'a' },
      },
      binary,
    )
    const reordered = await createSimulatorHandoffManifest(
      {
        commitSha: 'commit-1',
        files: { 'src/a.cpp': 'a', 'src/z.cpp': 'z' },
      },
      binary,
    )
    expect(manifest).toMatchObject({
      version: 1,
      format: 'vexcode-v5-raw',
      template: 'vexcode',
      commitSha: 'commit-1',
      artifact: { path: 'build/workspace.bin', size: 4 },
    })
    expect(manifest.sourceSha256).toBe(reordered.sourceSha256)
    expect(manifest.artifact.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  test('rejects absent and oversized binaries', async () => {
    const snapshot = { commitSha: 'commit-1', files: {} }
    await expect(
      createSimulatorHandoffManifest(snapshot, new Uint8Array()),
    ).rejects.toThrow('missing or too large')
    await expect(
      createSimulatorHandoffManifest(
        snapshot,
        new Uint8Array(32 * 1024 * 1024 + 1),
      ),
    ).rejects.toThrow('missing or too large')
  })
})

test.each(['pros', 'ez-template'] as const)(
  'packages both %s artifacts and binds their manifest to the committed source',
  async (template) => {
    const { simulatorBinary } = await import('./simulator-handoff')
    const { decodeSimulatorProgram } = await import('@v5x/simulator')
    const artifacts = new Map([
      ['bin/cold.package.bin', new Uint8Array([1, 2])],
      ['bin/hot.package.bin', new Uint8Array([3, 4])],
    ])
    const binary = simulatorBinary(template, artifacts)
    expect(decodeSimulatorProgram(binary)).toEqual({
      cold: artifacts.get('bin/cold.package.bin'),
      hot: artifacts.get('bin/hot.package.bin'),
    })
    expect(
      await createSimulatorHandoffManifest(
        { commitSha: 'commit', files: {} },
        binary,
        template,
      ),
    ).toMatchObject({
      template,
      format: 'pros-v5-package',
      artifact: { path: 'build/simulator.v5x' },
    })
    artifacts.delete('bin/cold.package.bin')
    expect(() => simulatorBinary(template, artifacts)).toThrow('both')
    expect(() => simulatorBinary('jar-template', artifacts)).toThrow(
      'cannot run',
    )
  },
)
