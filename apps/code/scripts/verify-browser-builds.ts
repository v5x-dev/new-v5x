import { compilerAssetLoader } from './compiler-asset-loader'
import { pathToFileURL } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { createSession, setAssetLoader } from 'microbit-clang-wasm'
import { templateFiles } from '../convex/template'
import { BrowserBuildSession } from '../src/lib/ide/build-session'
import { compileBrowserProject } from '../src/lib/ide/browser-build'
import { browserCompileCommands } from '../src/lib/ide/browser-build'
import { buildCacheKey } from '../src/lib/ide/build-cache'
import { readSdkBundle } from './read-sdk-bundle'
import { compilerObjectIdentity } from './compare-compiler-objects'
import type { BuildBundleFile } from '../src/lib/ide/build-archive'
import type { BuildCache } from '../src/lib/ide/build-cache'
import type { ProgramTemplate } from '../convex/template'

const publicDir = resolve(import.meta.dir, '../public')
setAssetLoader(await compilerAssetLoader())
const headers = JSON.parse(
  await readFile(resolve(publicDir, 'language/sdk-manifest.json'), 'utf8'),
)
const libraries = JSON.parse(
  await readFile(resolve(publicDir, 'compiler/sdk-manifest.json'), 'utf8'),
)
const outputDir = resolve(
  import.meta.dir,
  '../../../.build/browser-verification',
)
await mkdir(outputDir, { recursive: true })
// A distinct module owns the original compiler's global WASM/module caches.
const stockModulePath = resolve(outputDir, 'stock-runner.js')
await writeFile(
  stockModulePath,
  await readFile(
    resolve(
      import.meta.dir,
      '../node_modules/microbit-clang-wasm/gen/bundle.js',
    ),
  ),
)
const stockToolchain = (await import(
  pathToFileURL(stockModulePath).href
)) as typeof import('microbit-clang-wasm')
stockToolchain.setAssetLoader(await compilerAssetLoader(true))

for (const template of (process.env.BUILD_TEMPLATES?.split(',') ??
  Object.keys(templateFiles)) as Array<ProgramTemplate>) {
  // Exercise the browser's measured compiler choice and switch both module caches.
  setAssetLoader(
    await compilerAssetLoader(template !== 'ez-template'),
    template === 'ez-template' ? 'binaryen' : 'original',
  )
  const sdkFiles: Array<BuildBundleFile> = []
  for (const binary of [false, true]) {
    const manifest = binary ? libraries : headers
    for (const name of manifest.templates[template]) {
      const asset = manifest.bundles[name]
      sdkFiles.push(
        ...(await readSdkBundle(
          resolve(publicDir, asset.url.slice(1)),
          binary,
        )),
      )
    }
  }
  const pch = libraries.precompiled?.[template]
  if (pch) {
    sdkFiles.push([
      '/sdk/ez/main.pch',
      gunzipSync(await readFile(resolve(publicDir, pch.binary.url.slice(1)))),
    ])
    sdkFiles.push([
      '/sdk/ez/main-pch.json',
      await readFile(resolve(publicDir, pch.metadata.url.slice(1))),
    ])
  }
  const intermediates = new Map<string, Uint8Array>()
  const cache: BuildCache = {
    get: (key) => Promise.resolve(intermediates.get(key)?.slice()),
    put: (key, bytes) => {
      intermediates.set(key, bytes.slice())
      return Promise.resolve()
    },
  }
  const sdkKey = await buildCacheKey([
    JSON.stringify(headers),
    JSON.stringify(libraries),
  ])
  let retained: BrowserBuildSession | undefined
  const build = async (
    label: string,
    files: Record<string, string>,
    succeeds = true,
  ) => {
    const state =
      process.env.BUILD_FRESH_SESSION === '1'
        ? new BrowserBuildSession(createSession())
        : (retained ?? new BrowserBuildSession(createSession()))
    const session = state.session
    if (state !== retained) {
      await state.mount(sdkFiles)
      if (process.env.BUILD_FRESH_SESSION !== '1') retained = state
    }
    if (process.env.BUILD_PROFILE === '1' && state !== retained) {
      const run = session.run.bind(session)
      session.run = async (argv, options) => {
        const start = performance.now()
        const code = await run(argv, options)
        console.log(
          `${template} ${argv[0]} ${argv.at(-1)}: ${Math.round(performance.now() - start)} ms`,
        )
        return code
      }
    }
    const start = performance.now()
    let diagnosticOutput = ''
    const result = await compileBrowserProject(
      session,
      { files, template, commitSha: label },
      headers.gccVersion,
      (text) => {
        diagnosticOutput = (diagnosticOutput + text).slice(-400 * 1024)
      },
      {
        cache,
        sdkKey,
        state,
        compilerPlans: libraries.compilerPlans?.templates[template],
      },
    ).catch((error) => {
      console.error(diagnosticOutput)
      throw error
    })
    const prefix = resolve(outputDir, `${template}-${label}`)
    if (process.env.BUILD_PROFILE === '1')
      await writeFile(
        prefix + '.deps',
        (await session.readFile(
          '/workspace/.browser-build/src/main.cpp.o.d',
        )) ?? new Uint8Array(),
      )
    await writeFile(prefix + '.log', result.output)
    if ((result.exitCode === 0) !== succeeds)
      throw new Error(`${template} ${label}: ${result.output.slice(-4000)}`)
    if (!succeeds && result.artifacts.length)
      throw new Error('Failed compilation returned artifacts')
    if (succeeds) {
      const packaged = template === 'pros' || template === 'ez-template'
      const expectedPaths = packaged
        ? ['bin/hot.package.bin', 'bin/cold.package.bin']
        : ['build/workspace.bin']
      if (
        JSON.stringify(result.artifacts.map((artifact) => artifact.path)) !==
        JSON.stringify(expectedPaths)
      )
        throw new Error('Unexpected browser build artifacts')
      for (const artifact of result.artifacts) {
        const cold = artifact.path.endsWith('cold.package.bin')
        const artifactPrefix =
          prefix + (packaged ? (cold ? '-cold' : '-hot') : '')
        await writeFile(artifactPrefix + '.bin', artifact.bytes)
        const executable = await session.readFile(
          cold
            ? '/workspace/.browser-build/cold.package.elf'
            : '/workspace/.browser-build/program.elf',
        )
        if (
          !executable &&
          result.output.includes('Reused completed browser build')
        )
          continue
        if (!executable) throw new Error('Missing verification ELF')
        await writeFile(artifactPrefix + '.elf', executable)
        if (packaged && !cold) {
          if (
            Buffer.from(artifact.bytes.subarray(0, 8)).toString('hex') !==
            '686361521073ef8c'
          )
            throw new Error('Hot package is missing the PROS loader magic')
          if (Bun.which('arm-none-eabi-nm')) {
            const symbols = Bun.spawn(
              ['arm-none-eabi-nm', artifactPrefix + '.elf'],
              { stdout: 'pipe' },
            )
            const text = await new Response(symbols.stdout).text()
            if ((await symbols.exited) !== 0)
              throw new Error('Native nm failed')
            for (const name of [
              'install_hot_table',
              'initialize',
              'opcontrol',
            ]) {
              if (
                !new RegExp('^078[0-9a-f]{5} T ' + name + '$', 'm').test(text)
              )
                throw new Error(
                  'Hot program did not override cold symbol: ' + name,
                )
            }
            if (!/^038[0-9a-f]{5} [aAwW] delay$/m.test(text))
              throw new Error('Hot program did not import the cold SDK')
          }
        }
        if (Bun.which('arm-none-eabi-objcopy')) {
          const native = Bun.spawn([
            'arm-none-eabi-objcopy',
            '-O',
            'binary',
            ...(cold ? ['-R', '.hot_init'] : []),
            artifactPrefix + '.elf',
            artifactPrefix + '.native.bin',
          ])
          if ((await native.exited) !== 0)
            throw new Error('Native objcopy failed')
          if (
            !Buffer.from(artifact.bytes).equals(
              await readFile(artifactPrefix + '.native.bin'),
            )
          )
            throw new Error('Browser conversion differs from native objcopy')
        }
      }
    }
    console.log(
      `${template} ${label}: ${result.exitCode === 0 ? result.artifacts.map((artifact) => artifact.path + ': ' + artifact.bytes.length + ' bytes').join(', ') : 'expected failure'}, ${Math.round(performance.now() - start)} ms`,
    )
    return result
  }
  const original = templateFiles[template]
  const initial = await build('initial', original)
  if (process.env.BUILD_VERIFY_COMPILER_PLANS === '1') {
    const optimizedState = new BrowserBuildSession(createSession())
    const stockState = new BrowserBuildSession(stockToolchain.createSession())
    await optimizedState.mount(sdkFiles)
    await stockState.mount(sdkFiles)
    const main = original['src/main.cpp']
    const umbrella =
      template === 'pros' || template === 'ez-template' ? 'main.h' : 'vex.h'
    const fixtures = {
      original,
      'live-source': {
        ...original,
        'src/main.cpp': main.replace(/(pros::delay\(|wait\()\d+/, '$147'),
      },
      'live-header': {
        ...original,
        [`include/${umbrella}`]:
          original[`include/${umbrella}`] + '\n#define VERIFY_DELAY 47\n',
        'src/main.cpp': main.replace(
          /(pros::delay\(|wait\()\d+/,
          '$1VERIFY_DELAY',
        ),
      },
      'added-source': {
        ...original,
        'src/nested/new.cpp': `#include "${umbrella}"\nint nested_check() { return 47; }\n`,
      },
      'source-macro': {
        ...original,
        'src/main.cpp': '#define VERIFY_SOURCE_MACRO 1\n' + main,
      },
      'changed-prefix': {
        ...original,
        [`include/${umbrella}`]:
          '// changed preprocessing prefix\n' + original[`include/${umbrella}`],
      },
    }
    for (const [label, files] of Object.entries(fixtures)) {
      const commands = browserCompileCommands(
        { files, template, commitSha: label },
        headers.gccVersion,
      )
      const objects: Array<Uint8Array | null> = []
      for (const reference of [true, false]) {
        const state = reference ? stockState : optimizedState
        const checked = await compileBrowserProject(
          state.session,
          {
            files,
            template,
            commitSha: label,
            experiments: {
              pch: reference ? 'off' : undefined,
              driver: !reference,
              starter: false,
            },
          },
          headers.gccVersion,
          () => {},
          {
            cache: { get: async () => undefined, put: async () => {} },
            sdkKey,
            state,
            compilerPlans: libraries.compilerPlans?.templates[template],
          },
        )
        if (checked.exitCode) throw new Error(checked.output)
        const compiled = await Promise.all(
          commands.map((command) => state.session.readFile(command.object)),
        )
        if (reference) objects.push(...compiled)
        else
          for (const [index, bytes] of compiled.entries()) {
            if (
              !bytes ||
              !objects[index] ||
              JSON.stringify(compilerObjectIdentity(bytes)) !==
                JSON.stringify(compilerObjectIdentity(objects[index]!))
            ) {
              await writeFile(
                resolve(outputDir, 'reference.o'),
                objects[index] ?? new Uint8Array(),
              )
              await writeFile(
                resolve(outputDir, 'optimized.o'),
                bytes ?? new Uint8Array(),
              )
              throw new Error(
                `Optimized object differs from driver/no-PCH reference: ${template}/${label}/${commands[index].file}`,
              )
            }
          }
      }
      console.log(
        `${template}/${label}: code, data, symbols and relocations match original WASM compiler with full driver/no-PCH compilation`,
      )
    }
  }
  const cold = libraries.cold?.[template]
  if (cold) {
    const symbolsAsset = await readFile(
      resolve(publicDir, cold.symbols.url.slice(1)),
    )
    const symbols = new Uint8Array(
      cold.symbols.compression === 'gzip'
        ? gunzipSync(symbolsAsset)
        : symbolsAsset,
    )
    const binaryAsset = await readFile(
      resolve(publicDir, cold.binary.url.slice(1)),
    )
    const binary = new Uint8Array(
      cold.binary.compression === 'gzip'
        ? gunzipSync(binaryAsset)
        : binaryAsset,
    )
    const state = new BrowserBuildSession(createSession())
    await state.mount(sdkFiles)
    const prebuilt = await compileBrowserProject(
      state.session,
      { files: original, template, commitSha: 'prebuilt' },
      headers.gccVersion,
      () => {},
      {
        cache,
        sdkKey,
        state,
        prebuiltCold: { metadata: cold, symbols, binary },
      },
    )
    if (prebuilt.exitCode || prebuilt.output.includes('--no-gc-sections'))
      throw new Error('Prebuilt cold SDK was not eligible')
    if (
      !Buffer.from(prebuilt.artifacts[1].bytes).equals(
        initial.artifacts[1].bytes,
      )
    )
      throw new Error('Prebuilt cold binary differs from dynamic reference')
    console.log(`${template}: prebuilt cold SDK matches dynamic reference`)
  }
  if (
    process.env.BUILD_VERIFY_RUNTIME === '1' &&
    (template === 'pros' || template === 'ez-template')
  ) {
    await build('runtime-task', {
      ...original,
      'src/main.cpp': `
#include "main.h"
#include <cstdio>

void runtime_task() {
  std::puts("BROWSER_RUNTIME_TASK_OK");
  pros::screen::print(pros::E_TEXT_MEDIUM, 1, "Browser task started");
  while (true) pros::delay(20);
}

void initialize() {
  pros::Task task(runtime_task);
}

void disabled() {}
void competition_initialize() {}
void autonomous() {}
void opcontrol() { while (true) pros::delay(20); }
`,
    })
  }
  if (process.env.BUILD_PROFILE === '1') {
    const repeat = await build('repeat', original)
    if (
      !repeat.output.includes('Reused src/main.cpp.o.') &&
      !repeat.output.includes('Reused completed browser build')
    )
      throw new Error('Object cache missed')
    const edited = await build('edit-main', {
      ...original,
      'src/main.cpp':
        original['src/main.cpp'] + '\nint browser_speed_check = 1;\n',
    })
    if (
      template === 'ez-template' &&
      !edited.output.includes('Reused src/autons.cpp.o.')
    )
      throw new Error('Unchanged source was recompiled')
  }
  if (process.env.BUILD_VERIFY_SDK === '1') {
    await build('sdk-headers', {
      ...original,
      'src/main.cpp':
        original['src/main.cpp'] +
        '\nint browser_sdk_check();\nvolatile int browser_sdk_value = browser_sdk_check();\n',
      'src/browser-sdk-check.cpp': `
#include <algorithm>
#include <functional>
#include <map>
#include <memory>
#include <numeric>
#include <string>
#include <vector>

int browser_sdk_check() {
  std::vector<int> values{3, 1, 2};
  std::sort(values.begin(), values.end());
  std::unique_ptr<int> owned(new int(4));
  std::map<std::string, int> counts;
  counts["v5"] = *owned;
  return std::accumulate(values.begin(), values.end(), counts["v5"])
    + 2;
}
`,
    })
  }
  if (process.env.BUILD_VERIFY_EDITS !== '1') continue
  const main = original['src/main.cpp']
  const files: Record<string, string> = {
    ...original,
    'include/browser-check.h': '#define BROWSER_DELAY 41\n',
    'src/main.cpp':
      '#include "browser-check.h"\n' +
      main.replace(/(pros::delay\(|wait\()\d+/, '$1BROWSER_DELAY'),
  }
  const before = await build('add-header', files)
  files['include/browser-check.h'] = '#define BROWSER_DELAY 42\n'
  const after = await build('edit-header', files)
  if (after.output.includes('Reused src/main.cpp.o.'))
    throw new Error('Header edit reused a stale object')
  if (Buffer.from(before.artifacts[0].bytes).equals(after.artifacts[0].bytes))
    throw new Error('Header edit reused stale binary')
  if (
    before.artifacts.length === 2 &&
    !Buffer.from(before.artifacts[1].bytes).equals(after.artifacts[1].bytes)
  )
    throw new Error('User source edit changed the cold package')
  delete files['include/browser-check.h']
  await build('delete-header', files, false)
  files['src/main.cpp'] =
    main + '\n#error Deliberate browser compilation failure\n'
  await build('compiler-error', files, false)
  files['src/main.cpp'] =
    'int browser_check();\n' +
    main.replace(/(pros::delay\(|wait\()\d+/, '$1browser_check()')
  files['src/browser-check.cpp'] = 'int browser_check() { return 43; }\n'
  await build('add-source', files)
  delete files['src/browser-check.cpp']
  await build('delete-source', files, false)
  files['src/main.cpp'] =
    '#ifndef BROWSER_BUILD_FLAG\n#error Missing custom build flag\n#endif\n' +
    main
  const makefile = original.Makefile ? 'Makefile' : 'makefile'
  files[makefile] =
    original[makefile] +
    `\n${original.Makefile ? 'EXTRA_CXXFLAGS' : 'CXX_FLAGS'} += -DBROWSER_BUILD_FLAG=1\n`
  await build('custom-flags-and-recovery', files)
}
