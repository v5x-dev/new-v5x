import { compilerAssetLoader } from './compiler-asset-loader'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  createSession as currentSession,
  setAssetLoader as currentAssetLoader,
} from 'microbit-clang-wasm'
import { templateFiles } from '../convex/template'
import {
  compileBrowserProject as currentCompiler,
  browserCompileCommands,
} from '../src/lib/ide/browser-build'
import { compilerBenchmarkBaseline } from './compiler-benchmark-baseline'
import { pathToFileURL } from 'node:url'
import { BrowserBuildSession } from '../src/lib/ide/build-session'
import { readSdkBundle } from './read-sdk-bundle'
import type { BuildSdkManifest } from '../src/lib/ide/build-assets'
import type { BuildTimingEvent } from '../src/lib/ide/build-performance'
import type { ProgramTemplate } from '../convex/template'

const publicDir = resolve(import.meta.dir, '../public')
const load = (url: string) =>
  readFile(resolve(publicDir, url.replace(/^\//, '')))
const headers: BuildSdkManifest = JSON.parse(
  await load('/language/sdk-manifest.json').then(String),
)
const baseline = process.env.BUILD_BASELINE_REV
  ? await compilerBenchmarkBaseline(process.env.BUILD_BASELINE_REV)
  : undefined
const createSession = baseline?.toolchain.createSession ?? currentSession
const setAssetLoader = baseline?.toolchain.setAssetLoader ?? currentAssetLoader
const compileBrowserProject =
  baseline?.compiler.compileBrowserProject ?? currentCompiler
const libraries: BuildSdkManifest =
  baseline?.libraries ??
  JSON.parse(await load('/compiler/sdk-manifest.json').then(String))
const loadCompiler = await compilerAssetLoader(Boolean(baseline))
setAssetLoader((name) =>
  name === 'llvm.core.wasm' && process.env.BUILD_WASM_VARIANT
    ? readFile(resolve(process.env.BUILD_WASM_VARIANT))
    : loadCompiler(name),
)
const records = []
const variants = process.env.BUILD_WASM_VARIANTS?.split(',')
const runners = await Promise.all(
  (
    variants ?? [
      process.env.BUILD_WASM_VARIANT ?? (baseline ? 'historical' : 'optimized'),
    ]
  ).map(async (variant, index) => {
    const modulePath = resolve(
      import.meta.dir,
      '../../../.build/compiler-edits/variants',
      `runner-${index}.js`,
    )
    if (
      variants ||
      process.env.BUILD_SYNC_INSTANCE === '1' ||
      process.env.BUILD_SNAPSHOT_DEBUG === '1'
    ) {
      await mkdir(resolve(modulePath, '..'), { recursive: true })
      let bundle = await readFile(
        resolve(
          import.meta.dir,
          '../node_modules/microbit-clang-wasm/gen/bundle.js',
        ),
        'utf8',
      )
      if (process.env.BUILD_SYNC_INSTANCE === '1' && (!variants || index === 1))
        bundle = bundle.replace(
          'instantiateCore = WebAssembly.instantiate',
          'instantiateCore = (module, imports) => new WebAssembly.Instance(module, imports)',
        )
      if (
        process.env.BUILD_SNAPSHOT_DEBUG === '1' &&
        (!variants || index === 1)
      ) {
        const previous = bundle
        bundle = bundle.replace(
          /const _debugLog = \(\.\.\.args\) => \{\s*if \(!globalThis\?\.process\?\.env\?\.JCO_DEBUG\) \{\s*return;\s*\}\s*console\.debug\(\.\.\.args\);\s*\};/,
          'const _debugLog = globalThis?.process?.env?.JCO_DEBUG ? (...args) => console.debug(...args) : () => {};',
        )
        if (bundle === previous)
          throw new Error('Debug snapshot hook did not match the runtime')
      }
      await writeFile(modulePath, bundle)
    }
    const toolchain =
      variants ||
      process.env.BUILD_SYNC_INSTANCE === '1' ||
      process.env.BUILD_SNAPSHOT_DEBUG === '1'
        ? ((await import(
            pathToFileURL(modulePath).href
          )) as typeof import('microbit-clang-wasm'))
        : undefined
    toolchain?.setAssetLoader((name) =>
      name === 'llvm.core.wasm' && variant !== 'pinned'
        ? readFile(resolve(variant))
        : load(`/compiler/llvm-21.11.0-alpha.1/${name}`),
    )
    return {
      variant:
        process.env.BUILD_SYNC_INSTANCE === '1' && (!variants || index === 1)
          ? variant + ':sync-instance'
          : process.env.BUILD_RETAIN_AST === '1' && (!variants || index === 1)
            ? variant + ':retain-ast'
            : process.env.BUILD_NO_VALIDATE_PCH === '1' &&
                (!variants || index === 1)
              ? variant + ':checked-pch'
              : process.env.BUILD_SNAPSHOT_DEBUG === '1' &&
                  (!variants || index === 1)
                ? variant + ':snapshot-debug'
                : variant,
      retainAst:
        process.env.BUILD_RETAIN_AST === '1' && (!variants || index === 1),
      checkedPch:
        process.env.BUILD_NO_VALIDATE_PCH === '1' && (!variants || index === 1),
      createSession: toolchain?.createSession ?? createSession,
    }
  }),
)
if (runners.length > 1 && runners[0].createSession === runners[1].createSession)
  throw new Error('Benchmark variants require independent module caches')
const samples = Number(process.env.BUILD_BENCH_SAMPLES ?? 3)
const templates = (process.env.BUILD_TEMPLATES?.split(',') ??
  Object.keys(templateFiles)) as ProgramTemplate[]
for (const template of templates) {
  const mounts = []
  for (const [manifest, binary] of [
    [headers, false],
    [libraries, true],
  ] as const)
    for (const name of manifest.templates[template]!)
      mounts.push(
        ...(await readSdkBundle(
          resolve(publicDir, manifest.bundles[name]!.url.slice(1)),
          binary,
        )),
      )
  const pch = libraries.precompiled?.[template]
  if (pch)
    mounts.push(
      [
        '/sdk/ez/main.pch',
        process.env.BUILD_PCH_DIR
          ? await readFile(
              resolve(process.env.BUILD_PCH_DIR, `${template}.pch`),
            )
          : gunzipSync(await load(pch.binary.url)),
      ] as const,
      [
        '/sdk/ez/main-pch.json',
        process.env.BUILD_PCH_DIR
          ? await readFile(
              resolve(process.env.BUILD_PCH_DIR, `${template}.json`),
            )
          : await load(pch.metadata.url),
      ] as const,
    )
  const metadataObject = libraries.metadataObject
    ? await load(libraries.metadataObject.asset.url)
    : undefined
  const cold = libraries.cold?.[template]
  const prebuiltCold = cold
    ? {
        metadata: cold,
        symbols: gunzipSync(await load(cold.symbols.url)),
        binary: gunzipSync(await load(cold.binary.url)),
      }
    : undefined
  for (let sample = 0; sample < samples; sample++) {
    for (const runner of sample % 2 ? [...runners].reverse() : runners) {
      const state = new BrowserBuildSession(runner.createSession())
      if (runner.retainAst) {
        const exec = state.session.exec.bind(state.session)
        state.session.exec = (argv, options) =>
          exec(
            argv.filter((arg) => arg !== '-clear-ast-before-backend'),
            options,
          )
      }
      if (runner.checkedPch) {
        const exec = state.session.exec.bind(state.session)
        state.session.exec = (argv, options) =>
          exec(
            argv[1] === '-cc1' && argv.includes('-include-pch')
              ? [...argv, '-fno-validate-pch']
              : argv,
            options,
          )
      }
      if (process.env.BUILD_TIME_REPORT === '1') {
        const exec = state.session.exec.bind(state.session)
        state.session.exec = (argv, options) =>
          exec(argv[1] === '-cc1' ? [...argv, '-ftime-report'] : argv, options)
      }
      const startup = performance.now()
      await state.mount(mounts)
      const initializationMs = performance.now() - startup
      const entries = new Map<string, Uint8Array>()
      const cache = {
        get: async (key: string) => entries.get(key)?.slice(),
        put: async (key: string, bytes: Uint8Array) => {
          entries.set(key, bytes.slice())
        },
      }
      let previous: Uint8Array | undefined
      let previousObjectSha: string | undefined
      for (const scenario of [
        'fresh',
        'source-edit',
        'header-setup',
        'header-edit',
        'unchanged',
      ] as const) {
        const files = { ...templateFiles[template] }
        const main = files['src/main.cpp']
        if (scenario !== 'fresh') {
          files['src/main.cpp'] = main.replace(
            /(pros::delay\(|wait\()(\d+)/,
            (_, prefix, value) => `${prefix}${Number(value) + 1}`,
          )
          if (files['src/main.cpp'] === main)
            throw new Error(`No live edit for ${template}`)
        }
        if (
          scenario === 'header-setup' ||
          scenario === 'header-edit' ||
          scenario === 'unchanged'
        ) {
          const header =
            template === 'pros' || template === 'ez-template'
              ? 'main.h'
              : 'vex.h'
          files[`include/${header}`] +=
            `\n#define BENCH_DELAY ${scenario === 'header-setup' ? 46 : 47}\n`
          files['src/main.cpp'] = files['src/main.cpp'].replace(
            /(pros::delay\(|wait\()\d+/,
            '$1BENCH_DELAY',
          )
        }
        const spans: BuildTimingEvent[] = []
        const started = performance.now()
        const result = await compileBrowserProject(
          state.session,
          {
            files,
            template,
            commitSha: scenario,
            experiments: {
              starter: false,
              ...(process.env.BUILD_PCH === 'project'
                ? { pch: 'project' as const }
                : {}),
            },
          },
          headers.gccVersion,
          () => {},
          {
            cache,
            state,
            sdkKey: 'edit-benchmark',
            metadataObject,
            compilerPlans: libraries.compilerPlans?.templates[template],
            prebuiltCold,
            timing: (event) => spans.push(event),
          },
        )
        const ms = performance.now() - started
        if (result.exitCode) throw new Error(result.output)
        if (process.env.BUILD_TIME_REPORT === '1') console.log(result.output)
        const binary = result.artifacts[0].bytes
        if (
          previous &&
          scenario !== 'unchanged' &&
          Buffer.from(binary).equals(Buffer.from(previous))
        )
          throw new Error(`Live ${scenario} did not change binary`)
        const mainCommand = browserCompileCommands(
          { files, template, commitSha: scenario },
          headers.gccVersion,
        ).find((command) => command.file === '/workspace/src/main.cpp')!
        const mainObject = await state.session.readFile(mainCommand.object)
        if (!mainObject && scenario !== 'unchanged')
          throw new Error('Missing compiled main object')
        const objectSha256 = mainObject
          ? new Bun.CryptoHasher('sha256').update(mainObject).digest('hex')
          : previousObjectSha
        if (
          previousObjectSha &&
          scenario !== 'unchanged' &&
          previousObjectSha === objectSha256
        )
          throw new Error(`Live ${scenario} did not change source object code`)
        previousObjectSha = objectSha256
        previous = binary
        const record = {
          variant: runner.variant,
          template,
          scenario,
          sample,
          ms,
          initializationMs: scenario === 'fresh' ? initializationMs : 0,
          artifactBytes: binary.length,
          objectSha256,
          spans,
        }
        records.push(record)
        console.log(
          JSON.stringify({
            variant: runner.variant,
            template,
            scenario,
            sample,
            ms: Math.round(ms),
            initializationMs: Math.round(record.initializationMs),
          }),
        )
      }
    }
  }
}
const output = resolve(
  import.meta.dir,
  '../../../.build/compiler-edits',
  `${process.argv[2] ?? 'baseline'}.json`,
)
await mkdir(resolve(output, '..'), { recursive: true })
await writeFile(
  output,
  JSON.stringify(
    {
      host: `${process.platform}/${process.arch}, Bun ${Bun.version}; local WASM execution, no network`,
      baselineRevision: baseline?.commit,
      wasmVariant:
        process.env.BUILD_WASM_VARIANT ??
        (baseline ? 'historical' : 'optimized'),
      variants,
      pchDirectory: process.env.BUILD_PCH_DIR,
      samples,
      records,
    },
    null,
    2,
  ) + '\n',
)
console.log(output)
