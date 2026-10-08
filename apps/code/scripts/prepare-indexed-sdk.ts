import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { buildCacheKey } from '../src/lib/ide/build-cache'
import { encodeBuildArchive } from '../src/lib/ide/build-archive'
import type { BuildSdkManifest } from '../src/lib/ide/build-assets'

const publicDir = resolve(import.meta.dir, '../public')
const filename = resolve(publicDir, 'compiler/sdk-manifest.json')
const manifest: BuildSdkManifest = JSON.parse(await readFile(filename, 'utf8'))
for (const [name, asset] of Object.entries(manifest.bundles)) {
  if (!asset || asset.format === 'indexed-v1') continue
  const compressed = await readFile(resolve(publicDir, asset.url.slice(1)))
  if (
    compressed.length !== asset.bytes ||
    new Bun.CryptoHasher('sha256').update(compressed).digest('hex') !==
      asset.sha256
  )
    throw new Error(`Corrupt SDK asset: ${name}`)
  const original = gunzipSync(compressed)
  const bundle = JSON.parse(original.toString())
  const files = await Promise.all(
    Object.entries(bundle.files).map(async ([path, base64]) => {
      const bytes = new Uint8Array(Buffer.from(base64 as string, 'base64'))
      return [path, bytes, await buildCacheKey([bytes])] as const
    }),
  )
  const start = performance.now()
  const archive = encodeBuildArchive(files)
  const encoded = gzipSync(archive, { level: 9 })
  const digest = new Bun.CryptoHasher('sha256').update(encoded).digest('hex')
  const nameOnDisk = `${name}-${digest.slice(0, 16)}.sdk.gz`
  await writeFile(resolve(publicDir, 'compiler', nameOnDisk), encoded)
  console.log(
    JSON.stringify({
      bundle: name,
      jsonBytes: original.length,
      archiveBytes: archive.length,
      oldCompressedBytes: compressed.length,
      compressedBytes: encoded.length,
      encodeMs: performance.now() - start,
    }),
  )
  manifest.bundles[name] = {
    ...asset,
    format: 'indexed-v1',
    url: `/compiler/${nameOnDisk}`,
    bytes: encoded.length,
    sha256: digest,
  }
}
await writeFile(filename, JSON.stringify(manifest, null, 2) + '\n')
