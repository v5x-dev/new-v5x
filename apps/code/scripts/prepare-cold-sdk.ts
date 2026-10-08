import { readFile, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { createSession, setAssetLoader } from 'microbit-clang-wasm'
import { buildCacheKey } from '../src/lib/ide/build-cache'
import {
  coldSdkBinary,
  coldSdkConfiguration,
  coldSdkDigest,
  coldSdkSymbols,
  normalizeLinkerScript,
} from '../src/lib/ide/cold-sdk'
import { readSdkBundle } from './read-sdk-bundle'
import type { BuildAsset, BuildSdkManifest } from '../src/lib/ide/build-assets'

const publicDir = resolve(import.meta.dir, '../public')
const compilerDir = resolve(publicDir, 'compiler')
const compiler = JSON.parse(
  await readFile(
    resolve(compilerDir, 'llvm-21.11.0-alpha.1/manifest.json'),
    'utf8',
  ),
)
const headers: BuildSdkManifest = JSON.parse(
  await readFile(resolve(publicDir, 'language/sdk-manifest.json'), 'utf8'),
)
const libraries: BuildSdkManifest = JSON.parse(
  await readFile(resolve(compilerDir, 'sdk-manifest.json'), 'utf8'),
)
if (headers.gccVersion !== libraries.gccVersion)
  throw new Error('SDK version mismatch')
setAssetLoader((name) =>
  readFile(resolve(compilerDir, 'llvm-21.11.0-alpha.1', name)),
)
const compilerDigest = await buildCacheKey([JSON.stringify(compiler)])
libraries.compilerDigest = compilerDigest
libraries.headerDigest = await buildCacheKey([JSON.stringify(headers)])

for (const template of ['pros', 'ez-template']) {
  const session = createSession()
  for (const manifest of [headers, libraries]) {
    for (const name of manifest.templates[template]!) {
      const asset = manifest.bundles[name]!
      const bytes = await readFile(resolve(publicDir, asset.url.slice(1)))
      const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
      if (bytes.length !== asset.bytes || hash !== asset.sha256)
        throw new Error(`Corrupt SDK bundle: ${name}`)
      for (const [path, contents] of await readSdkBundle(
        resolve(publicDir, asset.url.slice(1)),
        manifest === libraries,
      ))
        await session.writeFile(path, contents)
    }
  }
  const scriptPath = '/workspace/firmware/v5-common.ld'
  await session.writeFile(
    '/workspace/.browser-build/linker.ld',
    normalizeLinkerScript(
      new TextDecoder().decode((await session.readFile(scriptPath))!),
    ),
  )
  const configuration = coldSdkConfiguration(template === 'ez-template')
  const inputsDigest = await coldSdkDigest(
    session,
    configuration.inputs,
    headers.gccVersion,
  )
  const code = await session.run(configuration.argv, {
    stderr: (bytes) => {
      if (bytes) process.stderr.write(bytes)
    },
  })
  if (code) throw new Error(`Cold link failed: ${template} (${code})`)
  const elf = (await session.readFile(
    '/workspace/.browser-build/cold.package.elf',
  ))!
  const asset = async (
    kind: string,
    bytes: Uint8Array,
  ): Promise<BuildAsset> => {
    bytes = gzipSync(bytes, { level: 9 })
    const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
    const filename = `${template}-cold-${sha256.slice(0, 16)}.${kind}.gz`
    await writeFile(resolve(compilerDir, filename), bytes)
    return {
      compression: 'gzip',
      url: `/compiler/${filename}`,
      sha256,
      bytes: bytes.length,
    }
  }
  libraries.cold ??= {}
  libraries.cold[template] = {
    version: 1,
    compilerDigest,
    inputsDigest,
    elf: await asset('elf', elf),
    symbols: await asset('symbols.elf', coldSdkSymbols(elf)),
    binary: await asset('bin', coldSdkBinary(elf)),
  }
  console.log(`Prepared ${template} cold SDK`)
}
// Publish the coherent manifest only after both templates have succeeded.
await writeFile(
  resolve(compilerDir, 'sdk-manifest.json'),
  JSON.stringify(libraries, null, 2) + '\n',
)
