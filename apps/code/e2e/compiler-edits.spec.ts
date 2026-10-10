import { buildCacheKey } from '../src/lib/ide/build-cache'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import { templateFiles } from '../convex/template'
import type { BuildTimingEvent } from '../src/lib/ide/build-performance'

// Uses the real application, editor, Build button, worker, and downloaded artifacts.
const enabled = process.env.BUILD_COMPILER_EDITS === '1'
const samples = Number(process.env.BUILD_BENCH_SAMPLES ?? 3)
const wasmVariant = process.env.BUILD_BROWSER_WASM ?? 'preferred'
const alternateCompiler = wasmVariant !== 'preferred'
const pinned = wasmVariant === 'pinned'
const syncInstance = process.env.BUILD_SYNC_INSTANCE === '1'
const snapshotDebug = process.env.BUILD_SNAPSHOT_DEBUG === '1'
const pchDirectory = process.env.BUILD_PCH_DIR
const label =
  process.env.BUILD_BENCH_LABEL ?? (pinned ? 'browser-pinned' : 'browser')
for (const template of Object.keys(templateFiles) as Array<
  keyof typeof templateFiles
>) {
  ;(enabled ? test : test.skip)(
    `${template} live compiler edits`,
    async ({ page }, testInfo) => {
      test.setTimeout(600_000)
      let modifiedRuntimeResponses = 0
      if (syncInstance || snapshotDebug)
        await page
          .context()
          .route('**/*microbit-clang-wasm*.js*', async (route) => {
            const response = await route.fetch()
            const source = await response.text()
            let replacement = source
            if (syncInstance)
              replacement = replacement.replace(
                'instantiateCore = WebAssembly.instantiate',
                'instantiateCore = (module, imports) => new WebAssembly.Instance(module, imports)',
              )
            if (snapshotDebug)
              replacement = replacement.replace(
                /const _debugLog = \(\.\.\.args\) => \{\s*if \(!globalThis\?\.process\?\.env\?\.JCO_DEBUG\)\s*\{?\s*return;\s*\}?\s*console\.debug\(\.\.\.args\);\s*\};/,
                'const _debugLog = globalThis?.process?.env?.JCO_DEBUG ? (...args) => console.debug(...args) : () => {};',
              )
            if (replacement !== source) modifiedRuntimeResponses++
            await route.fulfill({ response, body: replacement })
          })
      await page.addInitScript(() => {
        const state = window as any
        state.compilerSpans = []
        state.compilerResults = []
        const NativeWorker = window.Worker
        window.Worker = class extends NativeWorker {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options)
            this.addEventListener('message', ({ data }) => {
              if (data.kind === 'timing') state.compilerSpans.push(data.event)
              if (data.kind === 'result' || data.kind === 'error')
                state.compilerResults.push({
                  code: data.kind === 'error' ? -1 : data.result.exitCode,
                  output: data.result?.output,
                })
            })
          }
          postMessage(data: any, options?: any) {
            if (
              data.files &&
              data.template &&
              data.commitSha &&
              data.kind !== 'preload'
            )
              data = { ...data, trace: true, experiments: { starter: false } }
            super.postMessage(data, options)
          }
        }
      })
      if (alternateCompiler) {
        const directory = resolve(process.cwd(), 'public/compiler')
        const compiler = JSON.parse(
          await readFile(
            resolve(directory, 'llvm-21.11.0-alpha.1/manifest.json'),
            'utf8',
          ),
        )
        const core = await readFile(
          pinned
            ? resolve(directory, 'llvm-21.11.0-alpha.1/llvm.core.wasm')
            : resolve(wasmVariant),
        )
        delete compiler.templateFiles
        compiler.files['llvm.core.wasm'] = {
          bytes: core.length,
          sha256: createHash('sha256').update(core).digest('hex'),
        }
        const identity = await buildCacheKey([JSON.stringify(compiler)])
        const libraries = JSON.parse(
          await readFile(resolve(directory, 'sdk-manifest.json'), 'utf8'),
        )
        libraries.compilerDigest = identity
        libraries.compilerPlans.compilerDigest = identity
        libraries.metadataObject.compilerDigest = identity
        for (const cold of Object.values(libraries.cold) as any[])
          cold.compilerDigest = identity
        await page
          .context()
          .route('**/compiler/llvm-21.11.0-alpha.1/manifest.json', (route) =>
            route.fulfill({ json: compiler }),
          )
        await page
          .context()
          .route('**/compiler/sdk-manifest.json', (route) =>
            route.fulfill({ json: libraries }),
          )
        if (!pinned)
          await page
            .context()
            .route('**/compiler/llvm-21.11.0-alpha.1/llvm.core.wasm', (route) =>
              route.fulfill({ body: core, contentType: 'application/wasm' }),
            )
      }
      if (pchDirectory) {
        if (alternateCompiler)
          throw new Error('Test PCH and compiler variants separately')
        const directory = resolve(process.cwd(), 'public/compiler')
        const libraries = JSON.parse(
          await readFile(resolve(directory, 'sdk-manifest.json'), 'utf8'),
        )
        const binary = gzipSync(
          await readFile(resolve(pchDirectory, `${template}.pch`)),
          { level: 9 },
        )
        const metadata = await readFile(
          resolve(pchDirectory, `${template}.json`),
        )
        const asset = (bytes: Buffer, suffix: string) => ({
          url: `/compiler/${template}-experimental-pch.${suffix}`,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        })
        libraries.precompiled[template] = {
          binary: asset(binary, 'bundle'),
          metadata: asset(metadata, 'json'),
        }
        await page
          .context()
          .route('**/compiler/sdk-manifest.json', (route) =>
            route.fulfill({ json: libraries }),
          )
        await page
          .context()
          .route(`**/compiler/${template}-experimental-pch.bundle`, (route) =>
            route.fulfill({ body: binary }),
          )
        await page
          .context()
          .route(`**/compiler/${template}-experimental-pch.json`, (route) =>
            route.fulfill({ body: metadata }),
          )
      }
      const records = []
      const original = templateFiles[template]
      const umbrella =
        template === 'pros' || template === 'ez-template' ? 'main.h' : 'vex.h'
      for (let sample = 0; sample < samples; sample++) {
        await page.goto('/build-demo')
        await expect(
          page.getByRole('button', { name: 'Build in browser', exact: true }),
        ).toBeVisible()
        await expect(
          page.getByRole('textbox').filter({ visible: true }),
        ).toBeVisible()
        if (sample === 0)
          await page.evaluate(async () => {
            for (const key of await caches.keys())
              if (key.startsWith('v5x-browser-build')) await caches.delete(key)
          })
        else
          await page.evaluate(() =>
            caches.delete('v5x-browser-build-intermediates-v2'),
          )
        await page
          .getByLabel('Template', { exact: true })
          .selectOption(template)
        const edit = async (path: string, contents: string) => {
          await page.getByLabel('Source', { exact: true }).selectOption(path)
          await page.getByRole('textbox').filter({ visible: true }).click()
          await page.keyboard.press('ControlOrMeta+a')
          await page.keyboard.insertText(contents)
        }
        let previous: Buffer | undefined
        for (const scenario of [
          'fresh',
          'source-edit',
          'header-setup',
          'header-edit',
          'unchanged',
        ] as const) {
          let source = original['src/main.cpp'].replace(
            /(pros::delay\(|wait\()(\d+)/,
            (_, prefix, value) =>
              `${prefix}${Number(value) + sample * 3 + (scenario === 'fresh' ? 1 : 2)}`,
          )
          if (source === original['src/main.cpp'])
            throw new Error('Missing live edit')
          if (scenario === 'header-setup' || scenario === 'header-edit') {
            await edit(
              `include/${umbrella}`,
              original[`include/${umbrella}`] +
                `\n#define BENCH_DELAY ${scenario === 'header-setup' ? 46 : 47}\n`,
            )
            source = source.replace(
              /(pros::delay\(|wait\()\d+/,
              '$1BENCH_DELAY',
            )
          }
          if (scenario !== 'unchanged' && scenario !== 'header-edit')
            await edit('src/main.cpp', source)
          await page.evaluate(() => {
            ;(window as any).compilerSpans = []
          })
          const completed = await page.evaluate(
            () => (window as any).compilerResults.length,
          )
          const started = performance.now()
          await page
            .getByRole('button', { name: 'Build in browser', exact: true })
            .click()
          await expect
            .poll(
              () => page.evaluate(() => (window as any).compilerResults.length),
              { timeout: 180_000, intervals: [20] },
            )
            .toBe(completed + 1)
          await expect(page.getByRole('status')).toContainText(
            'Build succeeded',
          )
          const wallMs = performance.now() - started
          const metrics = await page.evaluate(() => ({
            spans: (window as any).compilerSpans as BuildTimingEvent[],
            result: (window as any).compilerResults.at(-1),
          }))
          expect(metrics.result.code, metrics.result.output).toBe(0)
          if (scenario !== 'unchanged')
            expect(metrics.spans.some((span) => span.phase === 'compile')).toBe(
              true,
            )
          const pending = page.waitForEvent('download')
          await page
            .getByRole('button', { name: /^Download / })
            .first()
            .click()
          const download = await pending
          expect(await download.failure()).toBeNull()
          const bytes = await readFile((await download.path())!)
          const binary = Buffer.from(bytes)
          if (previous && scenario !== 'unchanged')
            expect(binary.equals(previous)).toBe(false)
          previous = binary
          records.push({
            template,
            sample,
            scenario,
            wallMs,
            artifactBytes: bytes.length,
            spans: metrics.spans,
          })
          console.log(
            JSON.stringify({
              template,
              sample,
              scenario,
              wallMs: Math.round(wallMs),
            }),
          )
        }
      }
      const directory = resolve(
        process.cwd(),
        `../../.build/compiler-edits/${label}`,
      )
      if (syncInstance || snapshotDebug)
        expect(modifiedRuntimeResponses).toBeGreaterThan(0)
      await mkdir(directory, { recursive: true })
      const path = resolve(directory, `${template}.json`)
      await writeFile(
        path,
        JSON.stringify(
          {
            route: '/build-demo',
            wasmVariant,
            syncInstance,
            snapshotDebug,
            pchDirectory,
            userAgent: await page.evaluate(() => navigator.userAgent),
            network:
              'local Vite; first sample clears asset and object caches, subsequent fresh samples clear objects and restart worker',
            records,
          },
          null,
          2,
        ) + '\n',
      )
      await testInfo.attach('compiler-edits', {
        path,
        contentType: 'application/json',
      })
    },
  )
}

;(enabled ? test : test.skip)(
  'compiler variants switch within the same application worker',
  async ({ page }) => {
    test.setTimeout(180_000)
    const cores = new Set<string>()
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (/\/llvm\.core(?:-[0-9a-f]+)?\.wasm$/.test(path)) cores.add(path)
    })
    await page.goto('/build-demo')
    await expect(
      page.getByRole('textbox').filter({ visible: true }),
    ).toBeVisible()
    for (const [index, template] of (
      ['vexcode', 'ez-template', 'vexcode'] as const
    ).entries()) {
      await page.getByLabel('Template', { exact: true }).selectOption(template)
      await page
        .getByLabel('Source', { exact: true })
        .selectOption('src/main.cpp')
      await page.getByRole('textbox').filter({ visible: true }).click()
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.insertText(
        templateFiles[template]['src/main.cpp'].replace(
          /(pros::delay\(|wait\()\d+/,
          '$1' + (87 + index),
        ),
      )
      await page
        .getByRole('button', { name: 'Build in browser', exact: true })
        .click()
      await expect(page.locator('p[role="status"]')).toContainText(
        'Build succeeded',
        {
          timeout: 120_000,
        },
      )
    }
    expect([...cores].some((path) => path.endsWith('/llvm.core.wasm'))).toBe(
      true,
    )
    expect(
      [...cores].some((path) => /llvm\.core-[0-9a-f]+\.wasm$/.test(path)),
    ).toBe(true)
    expect(cores.size).toBe(2)
  },
)
