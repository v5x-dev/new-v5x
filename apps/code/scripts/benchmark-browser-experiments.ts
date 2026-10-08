import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createSession, setAssetLoader } from 'microbit-clang-wasm'
import { templateFiles } from '../convex/template'
import {
  browserCompileCommands,
  compileBrowserProject,
} from '../src/lib/ide/browser-build'
import { BrowserBuildSession } from '../src/lib/ide/build-session'
import { readSdkBundle } from './read-sdk-bundle'
import type { BrowserBuildInput } from '../src/lib/ide/browser-build'
import type { BuildSdkManifest } from '../src/lib/ide/build-assets'
import type { BuildTimingEvent } from '../src/lib/ide/build-performance'

const publicDir = resolve(import.meta.dir, '../public')
const headers: BuildSdkManifest = JSON.parse(
  await readFile(resolve(publicDir, 'language/sdk-manifest.json'), 'utf8'),
)
const libraries: BuildSdkManifest = JSON.parse(
  await readFile(resolve(publicDir, 'compiler/sdk-manifest.json'), 'utf8'),
)
setAssetLoader((name) =>
  readFile(resolve(publicDir, 'compiler/llvm-21.11.0-alpha.1', name)),
)
const records = []
for (const template of Object.keys(templateFiles) as Array<
  keyof typeof templateFiles
>) {
  const mounts = []
  for (const manifest of [headers, libraries])
    for (const name of manifest.templates[template]!)
      mounts.push(
        ...(await readSdkBundle(
          resolve(publicDir, manifest.bundles[name]!.url.slice(1)),
          manifest === libraries,
        )),
      )
  const original = templateFiles[template]
  const header =
    template === 'pros' || template === 'ez-template' ? 'main.h' : 'vex.h'
  const files = { ...original }
  // Header-heavy synthetic additions exercise PCH amortization without robot I/O.
  for (let index = 0; index < 8; index++)
    files[`src/benchmark_${index}.cpp`] =
      `#include "${header}"\nint benchmark_${index}(int x) { return x * ${index + 1}; }\n`
  for (const variant of ['Os', 'O0', 'O1', 'project-pch', 'driver'] as const) {
    const session = createSession(),
      state = new BrowserBuildSession(session)
    await state.mount(mounts)
    const experiments: BrowserBuildInput['experiments'] =
      variant === 'project-pch'
        ? { pch: 'project', starter: false }
        : {
            optimization: variant === 'driver' ? 'Os' : variant,
            pch: 'off',
            starter: false,
          }
    const input: BrowserBuildInput = {
      workspaceId: 'synthetic',
      buildId: `experiment-${template}-${variant}`,
      template,
      files,
      commitSha: 'synthetic',
      experiments,
    }
    await state.synchronize(files)
    if (variant === 'driver') {
      const command = browserCompileCommands(input, headers.gccVersion)[0]
      for (let sample = 0; sample < 10; sample++) {
        const start = performance.now()
        const code = await session.run([...command.argv, '-###'])
        records.push({
          template,
          variant,
          sample,
          ms: performance.now() - start,
          exitCode: code,
          artifactBytes: null,
          spans: [],
        })
      }
      continue
    }
    for (let sample = 0; sample < 10; sample++) {
      const spans: Array<BuildTimingEvent> = []
      const start = performance.now()
      const result = await compileBrowserProject(
        session,
        input,
        headers.gccVersion,
        () => {},
        {
          cache: {
            get: () => Promise.resolve(undefined),
            put: () => Promise.resolve(),
          },
          sdkKey: 'experiment',
          state,
          timing: (event) => spans.push(event),
          metadataObject: libraries.metadataObject
            ? new Uint8Array(
                await readFile(
                  resolve(
                    publicDir,
                    libraries.metadataObject.asset.url.slice(1),
                  ),
                ),
              )
            : undefined,
        },
      )
      records.push({
        template,
        variant,
        sample,
        ms: performance.now() - start,
        exitCode: result.exitCode,
        artifactBytes: result.artifacts.reduce(
          (sum, artifact) => sum + artifact.bytes.length,
          0,
        ),
        spans,
      })
      if (result.exitCode)
        throw new Error(`Experiment failed: ${template}/${variant}`)
    }
  }
}
const output = resolve(
  import.meta.dir,
  '../../../.build/browser-performance/compiler-experiments.json',
)
await mkdir(resolve(output, '..'), { recursive: true })
await writeFile(
  output,
  JSON.stringify(
    {
      schema: 1,
      environment:
        'Bun-hosted WASM, Intel i7-8700K/32GB development machine; not browser or Chromebook measurements',
      fixture:
        'standard template plus eight independent umbrella-header sources',
      memory: 'Total WASM peak memory unavailable',
      upload: 'No Brain connected',
      records,
    },
    null,
    2,
  ) + '\n',
)
console.log(output)
