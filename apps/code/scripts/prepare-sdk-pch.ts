import { compilerAssetLoader } from './compiler-asset-loader'
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
import { sdkPchHeader, sdkPchPrefix } from '../src/lib/ide/sdk-pch'
import type { ProgramTemplate } from '../convex/template'
import { compilerPlan } from '../src/lib/ide/compiler-plan'
import type { CompilerPlan } from '../src/lib/ide/compiler-plan'

const publicDir = resolve(import.meta.dir, '../public')
const compilerDir = resolve(publicDir, 'compiler')
const experimentDir = process.env.SDK_PCH_EXPERIMENT_DIR
  ? resolve(process.env.SDK_PCH_EXPERIMENT_DIR)
  : undefined
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
const compilerDigest = await buildCacheKey([JSON.stringify(compiler)])
setAssetLoader(await compilerAssetLoader())
for (const template of Object.keys(templateFiles) as ProgramTemplate[]) {
  // Finish pending SDK template instantiations once during preparation, rather
  // than in every translation unit. VEX showed no benefit in edit benchmarks.
  const generationFlags =
    experimentDir || template !== 'vexcode'
      ? ['-fpch-instantiate-templates']
      : []
  const files = templateFiles[template]
  const prefix = sdkPchPrefix(files, template)
  const command = browserCompileCommands(
    { files, template, commitSha: 'pch' },
    headers.gccVersion,
  )[0]
  const args = browserPchArguments(command)
  const signature = await buildCacheKey([
    'sdk-prefix-pch-v1',
    JSON.stringify(compiler),
    JSON.stringify(args),
    JSON.stringify(prefix),
    ...(generationFlags.length ? [JSON.stringify(generationFlags)] : []),
    ...[headers, libraries].map((manifest) =>
      JSON.stringify(
        manifest.templates[template].map(
          (name: string) => manifest.bundles[name],
        ),
      ),
    ),
  ])
  const existing = libraries.precompiled?.[template]
  if (
    !experimentDir &&
    existing?.provenance?.signature === signature &&
    libraries.compilerPlans?.compilerDigest === compilerDigest &&
    libraries.compilerPlans?.templates[template]?.length &&
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
        console.log(`${template} SDK precompiled headers are current`)
        continue
      }
    } catch {
      /* Regenerate missing assets. */
    }
  }
  const session = createSession()
  for (const binary of [false, true]) {
    const manifest = binary ? libraries : headers
    for (const name of manifest.templates[template]) {
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
  await session.writeFile(sdkPchHeader, prefix.header)
  const pchPath = '/sdk/ez/main.pch'
  const code = await session.run(
    [
      ...args,
      ...generationFlags,
      '-x',
      'c++-header',
      sdkPchHeader,
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
  if (code) throw new Error(`Could not prepare ${template} SDK PCH (${code})`)
  const plans: Array<CompilerPlan> = []
  for (const command of browserCompileCommands(
    { files, template, commitSha: 'plan' },
    headers.gccVersion,
  )) {
    for (const pch of [false, true]) {
      if (pch && !command.file.endsWith('.cpp')) continue
      const argv = [
        ...command.argv,
        ...(pch ? ['-include-pch', pchPath] : []),
        '-MD',
        '-MF',
        command.object + '.d',
      ]
      let output = ''
      const status = await session.run([...argv, '-###'], {
        stderr: (bytes) => {
          if (bytes) output += new TextDecoder().decode(bytes)
        },
      })
      const plan =
        status === 0
          ? compilerPlan(argv, output, command.file, command.object)
          : undefined
      if (!plan)
        throw new Error(
          `Unsupported compiler plan for ${template}/${command.file}`,
        )
      if (
        !plans.some(
          (entry) =>
            JSON.stringify(entry.driver) === JSON.stringify(plan.driver),
        )
      )
        plans.push(plan)
    }
  }
  libraries.compilerPlans = {
    compilerDigest,
    templates: { ...libraries.compilerPlans?.templates, [template]: plans },
  }
  const paths = dependencyPaths(
    new TextDecoder().decode((await session.readFile(pchPath + '.d'))!),
  )
  const parts: Array<string | Uint8Array> = []
  for (const path of paths)
    parts.push(path, await buildCacheKey([(await session.readFile(path))!]))
  const digest = await buildCacheKey(parts)
  const pchBytes = (await session.readFile(pchPath))!
  const bytes = gzipSync(pchBytes, { level: 9 })
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const filename = `${template}-sdk-pch-${sha256.slice(0, 16)}.pch.bundle`
  const metadata = Buffer.from(
    JSON.stringify({
      version: 4,
      prefix,
      arguments: args,
      paths,
      digest,
      workspacePaths: Object.keys(files).sort(),
      ...(generationFlags.length ? { generationFlags } : {}),
      ...(experimentDir
        ? { experiment: { flags: ['-fpch-instantiate-templates'] } }
        : {}),
    }),
  )
  const metadataHash = createHash('sha256').update(metadata).digest('hex')
  const metadataFilename = `${template}-sdk-pch-${metadataHash.slice(0, 16)}.json`
  if (experimentDir) {
    await mkdir(experimentDir, { recursive: true })
    await writeFile(resolve(experimentDir, `${template}.pch`), pchBytes)
    await writeFile(resolve(experimentDir, `${template}.json`), metadata)
    console.log(
      `Prepared experimental ${template} SDK PCH (${pchBytes.length} bytes)`,
    )
    continue
  }
  await mkdir(compilerDir, { recursive: true })
  await writeFile(resolve(compilerDir, filename), bytes)
  await writeFile(resolve(compilerDir, metadataFilename), metadata)
  delete libraries.bundles['ez-pch']
  libraries.precompiled = {
    ...libraries.precompiled,
    [template]: {
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
  console.log(
    `Prepared ${template} SDK precompiled headers (${bytes.length} bytes)`,
  )
}
