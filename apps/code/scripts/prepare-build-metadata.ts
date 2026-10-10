import { compilerAssetLoader } from './compiler-asset-loader'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createSession, setAssetLoader } from 'microbit-clang-wasm'
import {
  patchBuildMetadata,
  timestampArguments,
  timestampSource,
} from '../src/lib/ide/build-metadata'
import { buildCacheKey } from '../src/lib/ide/build-cache'
import type { BuildSdkManifest } from '../src/lib/ide/build-assets'

const compilerDir = resolve(import.meta.dir, '../public/compiler')
setAssetLoader(await compilerAssetLoader())
const session = createSession()
const source = '/workspace/timestamp.c',
  object = '/workspace/timestamp.o'
await session.writeFile(source, timestampSource)
if (await session.run(timestampArguments(source, object)))
  throw new Error('Metadata template compilation failed')
const bytes = (await session.readFile(object))!
if (!patchBuildMetadata(bytes))
  throw new Error('Metadata template schema validation failed')
const digest = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
const filename = `timestamp-${digest.slice(0, 16)}.o`
await writeFile(resolve(compilerDir, filename), bytes)
const manifestPath = resolve(compilerDir, 'sdk-manifest.json')
const manifest: BuildSdkManifest = JSON.parse(
  await readFile(manifestPath, 'utf8'),
)
const compiler = JSON.parse(
  await readFile(
    resolve(compilerDir, 'llvm-21.11.0-alpha.1/manifest.json'),
    'utf8',
  ),
)
manifest.metadataObject = {
  version: 1,
  compilerDigest: await buildCacheKey([JSON.stringify(compiler)]),
  asset: { url: `/compiler/${filename}`, sha256: digest, bytes: bytes.length },
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`Prepared validated metadata object (${bytes.length} bytes)`)
