import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { createSession, setAssetLoader } from 'microbit-clang-wasm'
import { templateFiles } from '../convex/template'
import { compileBrowserProject } from '../src/lib/ide/browser-build'
import { buildCacheKey } from '../src/lib/ide/build-cache'
import type { BuildCache } from '../src/lib/ide/build-cache'
import type { ProgramTemplate } from '../convex/template'

const publicDir = resolve(import.meta.dir, '../public')
setAssetLoader((name) =>
  readFile(resolve(publicDir, 'compiler/llvm-21.11.0-alpha.1', name)),
)
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

for (const template of (process.env.BUILD_TEMPLATES?.split(',') ??
  Object.keys(templateFiles)) as Array<ProgramTemplate>) {
  const sdkFiles: Array<readonly [string, string | Uint8Array]> = []
  for (const binary of [false, true]) {
    const manifest = binary ? libraries : headers
    for (const name of manifest.templates[template]) {
      const asset = manifest.bundles[name]
      const bundle = JSON.parse(
        gunzipSync(
          await readFile(resolve(publicDir, asset.url.slice(1))),
        ).toString(),
      )
      for (const [path, contents] of Object.entries(bundle.files))
        sdkFiles.push([
          path,
          binary
            ? Buffer.from(contents as string, 'base64')
            : (contents as string),
        ])
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
  const build = async (
    label: string,
    files: Record<string, string>,
    succeeds = true,
  ) => {
    const session = createSession()
    if (process.env.BUILD_PROFILE === '1') {
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
    for (const [path, contents] of sdkFiles)
      await session.writeFile(path, contents)
    const start = performance.now()
    let diagnosticOutput = ''
    const result = await compileBrowserProject(
      session,
      { files, template, commitSha: label },
      headers.gccVersion,
      (text) => {
        diagnosticOutput = (diagnosticOutput + text).slice(-400 * 1024)
      },
      { cache, sdkKey },
    ).catch((error) => {
      console.error(diagnosticOutput)
      throw error
    })
    const prefix = resolve(outputDir, `${template}-${label}`)
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
        await writeFile(
          artifactPrefix + '.elf',
          (await session.readFile(
            cold
              ? '/workspace/.browser-build/cold.package.elf'
              : '/workspace/.browser-build/program.elf',
          ))!,
        )
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
  await build('initial', original)
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
    if (!repeat.output.includes('Reused src/main.cpp.o.'))
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
