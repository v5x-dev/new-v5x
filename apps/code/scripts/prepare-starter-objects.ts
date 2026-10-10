import { compilerAssetLoader } from './compiler-asset-loader'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createSession, setAssetLoader } from 'microbit-clang-wasm'
import { templateFiles } from '../convex/template'
import { BrowserBuildSession } from '../src/lib/ide/build-session'
import { browserCompileCommands } from '../src/lib/ide/browser-build'
import { buildCacheKey, dependencyPaths } from '../src/lib/ide/build-cache'
import { readSdkBundle } from './read-sdk-bundle'
import type {
  BuildSdkManifest,
  StarterObject,
} from '../src/lib/ide/build-assets'

const publicDir = resolve(import.meta.dir, '../public')
const manifestPath = resolve(publicDir, 'compiler/sdk-manifest.json')
const headers: BuildSdkManifest = JSON.parse(
  await readFile(resolve(publicDir, 'language/sdk-manifest.json'), 'utf8'),
)
const manifest: BuildSdkManifest = JSON.parse(
  await readFile(manifestPath, 'utf8'),
)
const compiler = JSON.parse(
  await readFile(
    resolve(publicDir, 'compiler/llvm-21.11.0-alpha.1/manifest.json'),
    'utf8',
  ),
)
const compilerDigest = await buildCacheKey([JSON.stringify(compiler)])
setAssetLoader(await compilerAssetLoader())
manifest.starterObjects = {}
for (const template of Object.keys(templateFiles) as Array<
  keyof typeof templateFiles
>) {
  const session = createSession(),
    state = new BrowserBuildSession(session)
  const mounted = []
  for (const source of [headers, manifest])
    for (const name of source.templates[template]!)
      mounted.push(
        ...(await readSdkBundle(
          resolve(publicDir, source.bundles[name]!.url.slice(1)),
          source === manifest,
        )),
      )
  await state.mount(mounted)
  const files = templateFiles[template]
  await state.synchronize(files)
  const objects: Array<StarterObject> = []
  for (const command of browserCompileCommands(
    { files, template, commitSha: 'starter' },
    headers.gccVersion,
  )) {
    const depfile = command.object + '.d'
    if (await session.run([...command.argv, '-MD', '-MF', depfile]))
      throw new Error(`Starter compilation failed: ${template}`)
    const paths = dependencyPaths(
      new TextDecoder().decode((await session.readFile(depfile))!),
    )
    const parts: Array<string> = []
    for (const path of paths) {
      const digest = await state.dependencyDigest(path)
      if (!digest) throw new Error(`Time-sensitive starter dependency: ${path}`)
      parts.push(path, digest)
    }
    const bytes = (await session.readFile(command.object))!
    const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
    const filename = `${template}-starter-${sha256.slice(0, 16)}.o`
    await writeFile(resolve(publicDir, 'compiler', filename), bytes)
    objects.push({
      version: 1,
      compilerDigest,
      gccVersion: headers.gccVersion,
      arguments: command.argv,
      paths,
      digest: await buildCacheKey(parts),
      inventory: state.inventory(files),
      sourceDigest: (await state.dependencyDigest(command.file))!,
      asset: { url: `/compiler/${filename}`, sha256, bytes: bytes.length },
    })
  }
  manifest.starterObjects[template] = objects
  console.log(
    `Prepared ${template}: ${objects.length} starter objects, ${objects.reduce((sum, object) => sum + object.asset.bytes, 0)} bytes`,
  )
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
