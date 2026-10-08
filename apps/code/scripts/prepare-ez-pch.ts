import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { createSession, setAssetLoader } from 'microbit-clang-wasm'
import { templateFiles } from '../convex/template'
import {
  browserCompileCommands,
  browserPchArguments,
} from '../src/lib/ide/browser-build'
import { buildCacheKey, dependencyPaths } from '../src/lib/ide/build-cache'
import { readSdkBundle } from './read-sdk-bundle'

const publicDir = resolve(import.meta.dir, '../public')
const compilerDir = resolve(publicDir, 'compiler')
const libraries = JSON.parse(
  await readFile(resolve(compilerDir, 'sdk-manifest.json'), 'utf8'),
)
const headers = JSON.parse(
  await readFile(resolve(publicDir, 'language/sdk-manifest.json'), 'utf8'),
)
const compiler = JSON.parse(
  await readFile(
    resolve(compilerDir, 'llvm-21.11.0-alpha.1/manifest.json'),
    'utf8',
  ),
)
const files = templateFiles['ez-template']
const command = browserCompileCommands(
  { files, template: 'ez-template', commitSha: 'pch' },
  headers.gccVersion,
)[0]
const args = browserPchArguments(command)
const signature = await buildCacheKey([
  'ez-pch-v4',
  JSON.stringify(compiler),
  JSON.stringify(args),
  JSON.stringify(files),
  ...[headers, libraries].map((manifest) =>
    JSON.stringify(
      manifest.templates['ez-template'].map(
        (name: string) => manifest.bundles[name],
      ),
    ),
  ),
])
const existing = libraries.precompiled?.['ez-template']
if (
  existing?.provenance?.signature === signature &&
  !existing.binary.url.endsWith('.gz')
) {
  try {
    let valid = true
    for (const asset of [existing.binary, existing.metadata]) {
      const bytes = await readFile(resolve(publicDir, asset.url.slice(1)))
      valid &&=
        bytes.length === asset.bytes &&
        createHash('sha256').update(bytes).digest('hex') === asset.sha256
    }
    if (valid) {
      console.log('EZ precompiled headers are current')
      process.exit(0)
    }
  } catch {
    /* Regenerate missing assets. */
  }
}
setAssetLoader((name) =>
  readFile(resolve(compilerDir, 'llvm-21.11.0-alpha.1', name)),
)
const session = createSession()
for (const binary of [false, true]) {
  const manifest = binary ? libraries : headers
  for (const name of manifest.templates['ez-template']) {
    const asset = manifest.bundles[name]
    for (const [path, contents] of await readSdkBundle(
      resolve(publicDir, asset.url.slice(1)),
      binary,
    ))
      await session.writeFile(path, contents)
  }
}
for (const [path, contents] of Object.entries(files))
  await session.writeFile(`/workspace/${path}`, contents)
const pchPath = '/sdk/ez/main.pch'
const code = await session.run(
  [
    ...args,
    '-x',
    'c++-header',
    '/workspace/include/main.h',
    '-o',
    pchPath,
    '-MD',
    '-MF',
    pchPath + '.d',
  ],
  {
    stderr: (bytes) => {
      if (bytes) process.stderr.write(bytes)
    },
  },
)
if (code) throw new Error(`Could not prepare EZ PCH (${code})`)
const paths = dependencyPaths(
  new TextDecoder().decode((await session.readFile(pchPath + '.d'))!),
)
const parts: Array<string | Uint8Array> = []
for (const path of paths)
  parts.push(path, await buildCacheKey([(await session.readFile(path))!]))
const digest = await buildCacheKey(parts)
const bytes = gzipSync((await session.readFile(pchPath))!, { level: 9 })
const sha256 = createHash('sha256').update(bytes).digest('hex')
const filename = `ez-pch-${sha256.slice(0, 16)}.pch.bundle`
const metadata = Buffer.from(
  JSON.stringify({
    version: 3,
    arguments: args,
    paths,
    digest,
    workspacePaths: Object.keys(files).sort(),
  }),
)
const metadataHash = createHash('sha256').update(metadata).digest('hex')
const metadataFilename = `ez-pch-${metadataHash.slice(0, 16)}.json`
await mkdir(compilerDir, { recursive: true })
await writeFile(resolve(compilerDir, filename), bytes)
await writeFile(resolve(compilerDir, metadataFilename), metadata)
delete libraries.bundles['ez-pch']
libraries.precompiled = {
  'ez-template': {
    binary: { url: `/compiler/${filename}`, sha256, bytes: bytes.length },
    metadata: {
      url: `/compiler/${metadataFilename}`,
      sha256: metadataHash,
      bytes: metadata.length,
    },
    provenance: {
      compiler: compiler.version,
      signature,
      source: 'checked template and SDK headers; no user program code',
    },
  },
}
await writeFile(
  resolve(compilerDir, 'sdk-manifest.json'),
  JSON.stringify(libraries, null, 2) + '\n',
)
console.log(`Prepared EZ precompiled headers (${bytes.length} bytes)`)
