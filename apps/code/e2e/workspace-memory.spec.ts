import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, expect, test } from '@playwright/test'
import { createProgram, editor, gotoReady } from './fixtures'
import { templateFiles } from '../convex/template'
import { workerMemoryDiagnostics } from './worker-memory-diagnostics'

const enabled = process.env.BUILD_WORKSPACE_MEMORY === '1'
const budgetBytes = 256 * 1024 * 1024
const templates = ['VEXcode', 'PROS', 'EZ', 'JAR'].filter((template) =>
  (process.env.BUILD_WORKSPACE_MEMORY_TEMPLATES ?? 'VEXcode')
    .split(',')
    .includes(template),
)

for (const template of templates) {
  ;(enabled ? test : test.skip)(
    `${template} workspace memory through language startup and edited compilation`,
    async ({ baseURL }, testInfo) => {
      test.setTimeout(300_000)
      test.skip(process.platform !== 'linux', 'PSS sampling needs Linux /proc')
      const browser = await chromium.launch()
      const context = await browser.newContext()
      const serviceEndpoint = process.env.BUILD_WORKSPACE_MEMORY_SERVICE_FILE
        ? (
            await readFile(
              process.env.BUILD_WORKSPACE_MEMORY_SERVICE_FILE,
              'utf8',
            )
          ).trim()
        : process.env.BUILD_WORKSPACE_MEMORY_SERVICE
      if (serviceEndpoint) {
        await context.addInitScript((endpoint) => {
          localStorage.setItem('v5x-compilation-server-url', endpoint)
        }, serviceEndpoint)
      }
      const languageAssets = process.env.BUILD_WORKSPACE_MEMORY_LANGUAGE_ASSETS
      if (languageAssets) {
        await context.route(
          '**/language/clangd-15.0.7-small/*',
          async (route) => {
            const name = new URL(route.request().url()).pathname
              .split('/')
              .at(-1)!
            const contentType = name.endsWith('.wasm')
              ? 'application/wasm'
              : name.endsWith('.json')
                ? 'application/json'
                : 'text/javascript'
            await route.fulfill({
              body: await readFile(join(languageAssets, name)),
              contentType,
            })
          },
        )
      }
      const page = await context.newPage()
      const cpuThrottle = Number(process.env.BUILD_WORKSPACE_CPU_THROTTLE ?? 1)
      if (!Number.isFinite(cpuThrottle) || cpuThrottle < 1 || cpuThrottle > 20)
        throw new Error('CPU throttle must be between 1 and 20')
      if (cpuThrottle > 1) {
        const pageCdp = await context.newCDPSession(page)
        await pageCdp.send('Emulation.setCPUThrottlingRate', {
          rate: cpuThrottle,
        })
      }
      const metricCdp = await context.newCDPSession(page)
      const collectMetrics = process.env.BUILD_WORKSPACE_MEMORY_METRICS === '1'
      if (collectMetrics) await metricCdp.send('Performance.enable')
      const runtimeMetrics: Array<unknown> = []
      let metricPending = false
      const metricTimer = collectMetrics
        ? setInterval(() => {
            if (metricPending) return
            metricPending = true
            void metricCdp
              .send('Performance.getMetrics')
              .then(({ metrics }) => {
                runtimeMetrics.push({
                  elapsedMs: Math.round(performance.now() - started),
                  metrics: Object.fromEntries(
                    metrics.map(({ name, value }) => [name, value]),
                  ),
                })
              })
              .finally(() => {
                metricPending = false
              })
          }, 250)
        : undefined
      const browserWorkerUrls: Array<string> = []
      page.on('worker', (worker) => browserWorkerUrls.push(worker.url()))
      const cdp = await browser.newBrowserCDPSession()
      const diagnostic = process.env.BUILD_WORKSPACE_MEMORY_DIAGNOSTICS === '1'
      const workerMemory: Array<Record<string, unknown>> = []
      if (diagnostic) {
        await page.exposeFunction(
          'recordWorkerMemory',
          (value: Record<string, unknown>) => {
            workerMemory.push(value)
          },
        )
        await page.addInitScript(() => {
          const state = window as typeof window & {
            recordWorkerMemory: (value: unknown) => void
          }
          const NativeWorker = window.Worker
          window.Worker = class extends NativeWorker {
            constructor(url: string | URL, options?: WorkerOptions) {
              super(url, options)
              this.addEventListener('message', ({ data }) => {
                if (data?.kind === 'worker-memory-diagnostic')
                  void state.recordWorkerMemory({ url: String(url), ...data })
              })
            }
          }
        })
        await context.route(
          /\/(?:assets\/build\.worker[^/]*\.js|language\/clangd-host\.js)$/,
          async (route) => {
            const response = await route.fetch()
            await route.fulfill({
              response,
              body: workerMemoryDiagnostics + (await response.text()),
            })
          },
        )
      }
      const measurements: Array<{
        elapsedMs: number
        rendererBytes: number
        rendererSwapBytes: number
        browserBytes: number
        rendererProcesses: Array<{
          id: number
          bytes: number
          swapBytes: number
        }>
      }> = []
      const errors: Array<string> = []
      const memoryMaps: Array<unknown> = []
      let lastMappedBytes = 0
      const started = performance.now()
      let sampling: Promise<void> | undefined
      const sample = () => {
        if (sampling) return
        sampling = (async () => {
          const { processInfo } = await cdp.send('SystemInfo.getProcessInfo')
          const values = await Promise.all(
            processInfo.map(async ({ id, type }) => {
              const contents = await readFile(
                `/proc/${id}/smaps_rollup`,
                'utf8',
              )
              const match = /^Pss:\s+(\d+)\s+kB$/m.exec(contents)
              if (!match) throw new Error(`Missing PSS for ${type}`)
              return {
                id,
                type,
                bytes: Number(match[1]) * 1024,
                swapBytes:
                  Number(/^SwapPss:\s+(\d+)\s+kB$/m.exec(contents)?.[1] ?? 0) *
                  1024,
              }
            }),
          )
          const rendererBytes = values.reduce(
            (sum, value) => sum + (value.type === 'renderer' ? value.bytes : 0),
            0,
          )
          if (
            diagnostic &&
            rendererBytes > lastMappedBytes + 128 * 1024 * 1024
          ) {
            lastMappedBytes = rendererBytes
            for (const process of processInfo.filter(
              (value) => value.type === 'renderer',
            )) {
              const maps = await readFile(`/proc/${process.id}/smaps`, 'utf8')
              const entries = maps
                .split(/(?=^[0-9a-f]+-[0-9a-f]+ )/m)
                .map((entry) => ({
                  mapping: entry.split('\n')[0],
                  pssKiB: Number(/^Pss:\s+(\d+)/m.exec(entry)?.[1] ?? 0),
                }))
                .sort((a, b) => b.pssKiB - a.pssKiB)
                .slice(0, 20)
              memoryMaps.push({
                elapsedMs: performance.now() - started,
                rendererBytes,
                entries,
              })
            }
          }
          measurements.push({
            elapsedMs: Math.round(performance.now() - started),
            rendererBytes: values.reduce(
              (sum, value) =>
                sum + (value.type === 'renderer' ? value.bytes : 0),
              0,
            ),
            rendererSwapBytes: values.reduce(
              (sum, value) =>
                sum + (value.type === 'renderer' ? value.swapBytes : 0),
              0,
            ),
            browserBytes: values.reduce((sum, value) => sum + value.bytes, 0),
            rendererProcesses: values
              .filter((value) => value.type === 'renderer')
              .map(({ id, bytes, swapBytes }) => ({ id, bytes, swapBytes })),
          })
        })()
          .catch((error: unknown) => errors.push(String(error)))
          .then(() => {
            sampling = undefined
          })
      }
      const timer = setInterval(sample, 50)

      try {
        const signIn = await page.request.post(
          new URL('/api/auth/sign-in/anonymous', baseURL).toString(),
          { headers: { Origin: baseURL! }, data: {} },
        )
        expect(signIn.ok(), await signIn.text()).toBe(true)
        await gotoReady(page, new URL('/', baseURL).toString())
        await createProgram(page, template)
        const languageReady = page.getByRole('status', {
          name: 'C++ ready',
          exact: true,
        })
        const languageError = page.getByRole('alert').filter({ visible: true })
        await expect(languageReady.or(languageError).first()).toBeVisible({
          timeout: 120_000,
        })
        expect(
          await languageReady.isVisible(),
          (await languageError.allTextContents()).join('\n'),
        ).toBe(true)
        const languageReadyMs = Math.round(performance.now() - started)
        const rendererMapping: Array<unknown> = []
        if (process.env.BUILD_WORKSPACE_MEMORY_IDENTIFY === '1') {
          const frameTree = await metricCdp.send('Page.getFrameTree')
          rendererMapping.push({ frameTree })
          const events: Array<{ name?: string; args?: unknown }> = []
          const record = ({
            value,
          }: {
            value: Array<{ name?: string; args?: unknown }>
          }) => events.push(...value)
          cdp.on('Tracing.dataCollected', record)
          const complete = new Promise<void>((resolve) =>
            cdp.once('Tracing.tracingComplete', () => resolve()),
          )
          await cdp.send('Tracing.start', {
            categories: 'blink.user_timing',
            transferMode: 'ReportEvents',
          })
          for (const frame of page.frames())
            await frame.evaluate(() => performance.mark('v5x-memory-frame'))
          for (const worker of page.workers())
            await worker.evaluate(() => performance.mark('v5x-memory-worker'))
          await cdp.send('Tracing.end')
          await complete
          cdp.off('Tracing.dataCollected', record)
          rendererMapping.push(
            ...events.filter((event) =>
              /v5x-memory-frame|v5x-memory-worker/.test(event.name ?? ''),
            ),
          )
        }
        sample()
        await sampling
        const peakBeforeBuildBytes = Math.max(
          ...measurements.map((value) => value.rendererBytes),
        )
        await page
          .getByRole('treeitem', { name: 'main.cpp', exact: true })
          .click()
        const templateKey = {
          VEXcode: 'vexcode',
          PROS: 'pros',
          EZ: 'ez-template',
          JAR: 'jar-template',
        }[template]!
        // Pierre virtualizes rendered lines. Reading innerText would truncate
        // long files and turn the benchmark edit into invalid source code.
        const source =
          templateFiles[templateKey as keyof typeof templateFiles][
            'src/main.cpp'
          ]!
        const editValue = Number(
          process.env.BUILD_WORKSPACE_MEMORY_EDIT_VALUE ??
            Date.now() % 1_000_000,
        )
        if (
          !Number.isSafeInteger(editValue) ||
          editValue < 0 ||
          editValue > 1_000_000
        )
          throw new Error('Invalid benchmark edit value')
        const changed = source.replace(
          /((?:int main|void opcontrol)\([^)]*\)\s*\{)/,
          `$1\n  volatile int memory_benchmark_value = ${editValue};\n  (void)memory_benchmark_value;\n`,
        )
        expect(changed).not.toBe(source)
        await editor(page).click()
        await page.keyboard.press('ControlOrMeta+a')
        await page.keyboard.insertText(changed)
        const buildStarted = performance.now()
        await page
          .getByRole('button', { name: 'Save and build program', exact: true })
          .click()
        await expect(
          page.getByRole('button', { name: /^Build (succeeded|failed)/ }),
        ).toBeVisible({ timeout: 180_000 })
        if (
          await page
            .getByRole('button', { name: 'Build failed', exact: true })
            .isVisible()
        ) {
          await page
            .getByRole('button', { name: 'Output', exact: true })
            .click()
          throw new Error(
            await page
              .getByRole('region', { name: 'Output', exact: true })
              .innerText(),
          )
        }
        const buildMs = Math.round(performance.now() - buildStarted)
        // The success button appears after artifact persistence finishes. Keep
        // sampling briefly afterward to include delayed rendering and idle state.
        await page.waitForTimeout(2000)
        sample()
        await sampling
        clearInterval(timer)
        const peakRendererBytes = Math.max(
          ...measurements.map((v) => v.rendererBytes),
        )
        const peakRendererFootprintBytes = Math.max(
          ...measurements.map(
            (value) => value.rendererBytes + value.rendererSwapBytes,
          ),
        )
        const peakBrowserBytes = Math.max(
          ...measurements.map((v) => v.browserBytes),
        )
        const report = {
          template,
          route: '/p/:programId',
          execution: serviceEndpoint ? 'service' : 'browser',
          languageAssetOverride: Boolean(languageAssets),
          browserWorkerUrls,
          browserFrames: page
            .frames()
            .map((frame) => ({ url: frame.url(), name: frame.name() })),
          cpuThrottle,
          languageReadyMs,
          buildMs,
          editValue,
          peakBeforeBuildBytes,
          budgetBytes,
          peakRendererBytes,
          peakRendererFootprintBytes,
          peakBrowserBytes,
          sampledRendererWithinBudget:
            errors.length === 0 &&
            peakRendererBytes > 0 &&
            peakRendererFootprintBytes <= budgetBytes,
          boundary: `${diagnostic ? 'Diagnostic' : 'Uninstrumented'} dedicated Chromium. Linux PSS sampled every 50 ms. Renderer totals include the editor, clangd and compiler workers; browser totals also include browser/GPU/utility processes. Budget checks include renderer SwapPss so swapping cannot hide allocations. Sampling can miss transient peaks. PSS apportions shared resident pages and is not an exact allocation limit.`,
          measurements,
          rendererMapping,
          runtimeMetrics,
          errors,
          diagnostic,
          memoryMaps: diagnostic ? memoryMaps : undefined,
          workerMemory: diagnostic ? workerMemory : undefined,
        }
        console.log(
          JSON.stringify({
            kind: 'workspace-memory',
            ...report,
            measurements: undefined,
            runtimeMetrics: undefined,
            rendererMapping: undefined,
            memoryMaps: undefined,
            workerMemory: undefined,
          }),
        )
        const reportPath = testInfo.outputPath('workspace-memory.json')
        await writeFile(reportPath, JSON.stringify(report, null, 2))
        await testInfo.attach('workspace-memory.json', {
          path: reportPath,
          contentType: 'application/json',
        })
        if (serviceEndpoint) {
          expect(
            browserWorkerUrls.filter((url) =>
              /build\.worker|clangd-host/.test(url),
            ),
          ).toEqual([])
        }
        expect(measurements.length).toBeGreaterThan(0)
        expect(peakRendererBytes).toBeGreaterThan(0)
        if (process.env.BUILD_WORKSPACE_MEMORY_ENFORCE === '1') {
          expect(
            diagnostic,
            'Budget acceptance requires uninstrumented workers',
          ).toBe(false)
          expect(
            errors,
            'Incomplete memory sampling cannot prove the budget',
          ).toEqual([])
          expect(peakRendererFootprintBytes).toBeLessThanOrEqual(budgetBytes)
        }
      } finally {
        clearInterval(timer)
        clearInterval(metricTimer)
        await sampling
        await cdp.detach()
        await context.close()
        await browser.close()
      }
    },
  )
}
