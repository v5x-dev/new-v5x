import { expect, it } from 'bun:test'
import { decodeBuildArchive, encodeBuildArchive } from './build-archive'
import { buildCacheKey } from './build-cache'

it('round-trips raw archive payloads and validates ranges, paths, duplicates and index bounds', async () => {
  const bytes = new Uint8Array([0, 255, 1])
  const digest = await buildCacheKey([bytes])
  const archive = encodeBuildArchive([
    ['/workspace/firmware/a.a', bytes, digest],
  ])
  const [[path, decoded, identity]] = decodeBuildArchive(archive)
  expect(path).toBe('/workspace/firmware/a.a')
  expect([...(decoded as Uint8Array)]).toEqual([...bytes])
  expect(identity).toBe(digest)
  for (const invalid of ['/workspace/../a', '/workspace//a', '/private/a'])
    expect(() => encodeBuildArchive([[invalid, bytes, digest]])).toThrow()
  expect(() =>
    encodeBuildArchive([
      ['/sdk/a', bytes, digest],
      ['/sdk/a', bytes, digest],
    ]),
  ).toThrow()
  const oversized = archive.slice()
  new DataView(oversized.buffer).setUint32(8, 0xffffffff, true)
  expect(() => decodeBuildArchive(oversized)).toThrow('index size')
  expect(() =>
    decodeBuildArchive(archive.subarray(0, archive.length - 1)),
  ).toThrow('range')
})
