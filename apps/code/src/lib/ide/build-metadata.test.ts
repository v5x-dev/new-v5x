import { readFileSync } from 'node:fs'
import { expect, it } from 'bun:test'
import manifest from '../../../public/compiler/sdk-manifest.json'
import { formatBuildTimestamp, patchBuildMetadata } from './build-metadata'

it('patches validated ARM metadata without mutating its template and rejects foreign or corrupt objects', () => {
  const bytes = new Uint8Array(
    readFileSync(
      new URL(
        '../../../public' + manifest.metadataObject.asset.url,
        import.meta.url,
      ),
    ),
  )
  const original = bytes.slice()
  const date = new Date('2026-10-07T04:05:06Z')
  const patched = patchBuildMetadata(bytes, date)!
  expect(patched).toBeDefined()
  expect(formatBuildTimestamp(date)).toBe('Oct  7 2026 04:05:06')
  expect(new TextDecoder().decode(patched)).toContain('Oct  7 2026 04:05:06\0')
  expect(bytes).toEqual(original)
  expect(patchBuildMetadata(bytes, new Date('2040-01-01'))).toBeUndefined()
  for (const offset of [0, 4, 5, 16, 18, 46]) {
    const corrupt = bytes.slice()
    corrupt[offset] = 255
    expect(patchBuildMetadata(corrupt, date)).toBeUndefined()
  }
  expect(patchBuildMetadata(bytes.subarray(0, 60), date)).toBeUndefined()
})
