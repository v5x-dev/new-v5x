import { gzipSync } from 'node:zlib'
import { expect, it } from 'bun:test'
import { decompressBuildBytes } from './build-assets'

it('bounds decompression and rejects broken gzip data', async () => {
  const bytes = gzipSync('sdk bytes')
  expect(new TextDecoder().decode(await decompressBuildBytes(bytes, 9))).toBe(
    'sdk bytes',
  )
  await expect(decompressBuildBytes(bytes, 8)).rejects.toThrow('size limit')
  await expect(decompressBuildBytes(new Uint8Array([1, 2]))).rejects.toThrow()
})
