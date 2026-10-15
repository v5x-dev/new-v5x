import { describe, expect, test } from 'bun:test'
import { parseBrainSlot, selectUploadArtifacts } from './brain-upload'

const bytes = (value: number) => new Uint8Array([value])

describe('selectUploadArtifacts', () => {
  test('uploads a VEXcode binary on its own', () => {
    const artifacts = new Map([['build/workspace.bin', bytes(1)]])
    expect(selectUploadArtifacts(artifacts, 'src/main.cpp')).toEqual({
      programBytes: bytes(1),
      coldBytes: undefined,
    })
  })

  test('pairs the PROS hot package with its cold package', () => {
    const artifacts = new Map([
      ['bin/cold.package.bin', bytes(1)],
      ['bin/hot.package.bin', bytes(2)],
    ])

    for (const selected of [undefined, 'bin/cold.package.bin'])
      expect(selectUploadArtifacts(artifacts, selected)).toEqual({
        programBytes: bytes(2),
        coldBytes: bytes(1),
      })
  })

  test('prefers a selected program artifact', () => {
    const artifacts = new Map([
      ['bin/hot.package.bin', bytes(1)],
      ['bin/monolith.bin', bytes(2)],
    ])
    expect(selectUploadArtifacts(artifacts, 'bin/monolith.bin')).toEqual({
      programBytes: bytes(2),
      coldBytes: undefined,
    })
  })

  test('returns null without a program artifact', () => {
    expect(selectUploadArtifacts(new Map(), undefined)).toBeNull()
    expect(
      selectUploadArtifacts(
        new Map([['bin/cold.package.bin', bytes(1)]]),
        undefined,
      ),
    ).toBeNull()
  })
})

describe('parseBrainSlot', () => {
  test('accepts slots 1 to 8 and falls back to 1', () => {
    expect(parseBrainSlot('8')).toBe(8)
    for (const value of [null, '', '0', '9', '2.5', 'x'])
      expect(parseBrainSlot(value)).toBe(1)
  })
})
