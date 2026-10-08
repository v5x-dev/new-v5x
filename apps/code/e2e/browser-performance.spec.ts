import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { templateFiles } from '../convex/template'
import {
  appendComment,
  commitChanges,
  createProgram,
  expect,
  gotoReady,
  test,
} from './fixtures'
import type { BuildTimingEvent } from '../src/lib/ide/build-performance'

// Explicitly opt in: these are real authenticated repositories and repeated WASM builds.
const enabled = process.env.BUILD_BROWSER_BENCH === '1'
const samples = Math.max(10, Number(process.env.BUILD_BROWSER_SAMPLES) || 10)
const variants = (process.env.BUILD_BROWSER_VARIANTS ?? 'optimized').split(',')
const allTemplates = [
  ['vexcode', 'VEXcode'],
  ['pros', 'PROS'],
  ['ez-template', 'EZ'],
  ['jar-template', 'JAR'],
] as const

const templates = allTemplates.filter(
  ([template]) =>
    !process.env.BUILD_BROWSER_TEMPLATES ||
    process.env.BUILD_BROWSER_TEMPLATES.split(',').includes(template),
)
for (const [template, label] of templates) {
  for (const route of (process.env.BUILD_BROWSER_ROUTES?.split(',') ?? [
    'demo',
    'project',
  ]) as Array<'demo' | 'project'>) {
    ;(enabled ? test : test.skip)(
      `${template} ${route} browser performance`,
      async ({ page, baseURL, browserName }, testInfo) => {
        test.skip(
          !enabled,
          'Set BUILD_BROWSER_BENCH=1 to collect browser-only samples',
        )
        test.setTimeout(900_000)
        await page.addInitScript(() => {
          const state = window as typeof window & {
            buildSpans: Array<unknown>
            longTasks: Array<number>
            buildCompletions: number
            buildExitCode: number
            buildErrors: Array<string>
          }
          state.buildSpans = []
          state.longTasks = []
          state.buildCompletions = 0
          state.buildExitCode = 0
          state.buildErrors = []
          try {
            new PerformanceObserver((list) =>
              state.longTasks.push(
                ...list.getEntries().map((entry) => entry.duration),
              ),
            ).observe({ type: 'longtask', buffered: true })
          } catch {
            /* Unsupported browser metric. */
          }
          const NativeWorker = window.Worker
          window.Worker = class extends NativeWorker {
            constructor(url: string | URL, options?: WorkerOptions) {
              super(url, options)
              this.addEventListener('message', ({ data }) => {
                if (data.kind === 'timing') state.buildSpans.push(data.event)
                if (data.kind === 'result' || data.kind === 'error') {
                  state.buildCompletions++
                  state.buildExitCode =
                    data.kind === 'result' ? data.result.exitCode : -1
                  state.buildErrors =
                    data.kind === 'result'
                      ? data.result.output
                          .split('\n')
                          .filter((line: string) =>
                            /error:|undefined symbol:/.test(line),
                          )
                      : []
                }
              })
            }
            postMessage(data: any, options?: any) {
              // Compiler requests have this shape; language worker messages do not.
              if (
                data.files &&
                data.template &&
                data.commitSha &&
                data.kind !== 'preload'
              ) {
                const variant = (window as any).buildVariant ?? 'optimized'
                const experiments =
                  variant === 'reference'
                    ? {
                        freshSession: true,
                        cache: false,
                        prebuiltCold: false,
                        metadata: 'compile',
                        pch: 'off',
                        starter: false,
                      }
                    : variant === 'parallel'
                      ? {
                          parallel: 2,
                          cache: false,
                          pch: 'off',
                          starter: false,
                        }
                      : variant === 'project-pch'
                        ? { pch: 'project', starter: false }
                        : /^O[01]$/.test(variant)
                          ? {
                              optimization: variant,
                              cache: false,
                              pch: 'off',
                              starter: false,
                            }
                          : {}
                data = { ...data, experiments, trace: variant !== 'untraced' }
              }
              super.postMessage(data, options)
            }
          }
        })
        if (route === 'project') {
          const response = await page.request.post(
            '/api/auth/sign-in/anonymous',
            { headers: { Origin: baseURL! }, data: {} },
          )
          expect(response.ok()).toBe(true)
          await gotoReady(page, '/')
          await createProgram(page, label)
        } else {
          await gotoReady(page, '/build-demo')
          await expect(
            page.getByRole('textbox', { name: 'src/main.cpp', exact: true }),
          ).toBeVisible()
          await page
            .getByRole('combobox', { name: 'Template', exact: true })
            .selectOption(template)
        }
        const device = await page.evaluate(() => ({
          userAgent: navigator.userAgent,
          hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemory:
            (navigator as Navigator & { deviceMemory?: number }).deviceMemory ??
            null,
          memory:
            'Total browser/WASM memory unavailable; JS heap is not total memory',
        }))
        const records: Array<{
          scenario: string
          variant: string
          interactionMs: number | null
          wallMs: number
          commitMs: number
          spans: Array<BuildTimingEvent>
          longTasks: Array<number>
          success: boolean
        }> = []
        await page.evaluate(async () => {
          for (const name of await caches.keys())
            if (name.startsWith('v5x-browser-build')) await caches.delete(name)
        })
        for (let index = 0; index <= samples * 2; index++) {
          const scenario =
            index === 0
              ? 'initial-site-cache-unspecified'
              : index <= samples
                ? 'warm-noop'
                : 'one-source-comment-edit'
          let commitMs = 0
          if (scenario === 'one-source-comment-edit') {
            const start = performance.now()
            if (route === 'project') {
              await appendComment(page, `browser benchmark ${index}`)
              await commitChanges(page)
            } else {
              await page
                .getByRole('textbox', { name: 'src/main.cpp', exact: true })
                .click()
              await page.keyboard.press('ControlOrMeta+End')
              await page.keyboard.insertText(
                `\n// browser benchmark ${index}\n`,
              )
            }
            commitMs = performance.now() - start
          }
          const orderedVariants = index % 2 ? [...variants].reverse() : variants
          for (const variant of orderedVariants) {
            await page.evaluate((selectedVariant) => {
              ;(window as any).buildVariant = selectedVariant
            }, variant)
            await page.evaluate(() => {
              const state = window as any
              state.buildSpans = []
              state.longTasks = []
            })
            const completed = await page.evaluate(
              () => (window as any).buildCompletions as number,
            )
            const started = performance.now()
            await page
              .getByRole('button', {
                name:
                  route === 'project'
                    ? /^(Build program|Build succeeded|Build restored)$/
                    : 'Build in browser',
                exact: true,
              })
              .click()
            let success = true
            let interactionMs: number | null = null
            if (
              route === 'project' &&
              index > 0 &&
              process.env.BUILD_BROWSER_INTERACTIONS === '1'
            ) {
              const interactionStart = performance.now()
              const textbox = page
                .getByRole('textbox')
                .filter({ visible: true })
              await textbox.click()
              await page.keyboard.press('ControlOrMeta+End')
              await page.keyboard.insertText(' ')
              await page.evaluate(
                () =>
                  new Promise((painted) =>
                    requestAnimationFrame(() => requestAnimationFrame(painted)),
                  ),
              )
              interactionMs = performance.now() - interactionStart
              await page.keyboard.press('ControlOrMeta+z')
            }
            try {
              await expect
                .poll(
                  () =>
                    page.evaluate(
                      () => (window as any).buildCompletions as number,
                    ),
                  { timeout: 300_000, intervals: [20] },
                )
                .toBe(completed + 1)
              const status = await page.evaluate(() => ({
                code: (window as any).buildExitCode,
                errors: (window as any).buildErrors,
              }))
              if (status.code !== 0)
                throw new Error(status.errors.join('\n') || 'Compiler failed')
              await expect(
                route === 'demo'
                  ? page
                      .getByRole('status')
                      .filter({ hasText: 'Build succeeded' })
                  : page.getByRole('button', {
                      name: 'Build succeeded',
                      exact: true,
                    }),
              ).toBeVisible({ timeout: 300_000 })
            } catch (error) {
              console.error(
                error instanceof Error
                  ? error.message
                  : 'Browser verification failed',
              )
              success = false
            }
            const metrics = await page.evaluate(() => ({
              spans: (window as any).buildSpans as Array<BuildTimingEvent>,
              longTasks: (window as any).longTasks as Array<number>,
            }))
            records.push({
              scenario,
              variant,
              interactionMs,
              wallMs: performance.now() - started,
              commitMs,
              ...metrics,
              success,
            })
            if (!success) break
          }
          if (records.some((record) => !record.success)) break
          if (index % 10 === 0)
            console.log(
              `${template}/${route}: pair ${index}/${samples * 2} complete`,
            )
        }
        const summary = Object.fromEntries(
          [
            ...new Set(
              records.map((record) => `${record.variant}/${record.scenario}`),
            ),
          ].map((scenario) => {
            const selected = records.filter(
              (record) => `${record.variant}/${record.scenario}` === scenario,
            )
            const times = selected
              .filter((record) => record.success)
              .map((record) => record.wallMs)
              .sort((a, b) => a - b)
            return [
              scenario,
              {
                count: selected.length,
                failures: selected.filter((record) => !record.success).length,
                medianMs: times.length
                  ? (times[Math.floor((times.length - 1) / 2)] +
                      times[Math.floor(times.length / 2)]) /
                    2
                  : null,
                p95Ms:
                  times.length >= 20
                    ? times[Math.ceil(times.length * 0.95) - 1]
                    : null,
                rangeMs: times.length ? [times[0], times.at(-1)] : null,
              },
            ]
          }),
        )
        const report = {
          schema: 2,
          template,
          route,
          browserName,
          device,
          mode: 'unthrottled-real-route',
          upload: 'Brain upload excluded from browser build timings',
          compiler: '21.11.0-alpha.1',
          fixtureDigest: createHash('sha256')
            .update(
              JSON.stringify(Object.entries(templateFiles[template]).sort()),
            )
            .digest('hex'),
          deviceLabel:
            process.env.BUILD_BROWSER_DEVICE ??
            'Development host, model/CPU/power state unspecified',
          baseline: variants.includes('reference')
            ? 'Alternating current-code reference switches and optimized builds on identical snapshots; not a historical pre-change baseline'
            : 'No alternating reference samples',
          cacheState:
            'Compiler Cache Storage cleared before initial build; language service may already have cached language assets',
          variants,
          records,
          summary,
        }
        const directory = resolve(
          process.cwd(),
          '../../.build/browser-performance',
        )
        await mkdir(directory, { recursive: true })
        const path = resolve(directory, `${template}-${route}.json`)
        await writeFile(path, JSON.stringify(report, null, 2) + '\n')
        await testInfo.attach('browser-performance', {
          path,
          contentType: 'application/json',
        })
        expect(records.every((record) => record.success)).toBe(true)
      },
    )
  }
}
