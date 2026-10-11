import {
  commitChanges,
  createProgram,
  editor,
  expect,
  reloadReady,
  test,
} from './fixtures'

test('build a program, show output, enable upload and restore artifacts on reload', async ({
  programPage: page,
}) => {
  test.setTimeout(300_000)
  // Wait for the mounted IDE before clicking a server-rendered button.
  await expect(
    page.getByRole('status', { name: 'C++ ready', exact: true }),
  ).toBeVisible({ timeout: 120_000 })
  const build = page.getByRole('button', { name: 'Build program', exact: true })
  await expect(build).toBeEnabled()
  await build.click()
  // A preloaded starter build can finish before polling sees the busy state.
  await expect(
    page.getByRole('button', { name: 'Build succeeded', exact: true }),
  ).toBeVisible({
    timeout: 240_000,
  })
  await page.getByRole('button', { name: 'Output', exact: true }).click()
  const output = page.getByRole('dialog', { name: 'Output', exact: true })
  await expect(output.locator('pre')).not.toHaveText(
    'Build the project to see compiler output.',
  )
  await page.keyboard.press('Escape')
  await page
    .getByRole('button', { name: 'Upload to Brain', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Upload to Brain', exact: true }).last(),
  ).toBeEnabled()
  await page.keyboard.press('Escape')
  await reloadReady(page)
  await expect(editor(page)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Build restored' }),
  ).toBeEnabled()
  await page
    .getByRole('button', { name: 'Upload to Brain', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Upload to Brain', exact: true }).last(),
  ).toBeEnabled()
})

for (const template of ['VEXcode', 'PROS', 'EZ', 'JAR']) {
  test(`${template} compiles in the browser without invoking cloud builds`, async ({
    signedInPage: page,
  }) => {
    test.setTimeout(300_000)
    await page.addInitScript(() => {
      const NativeWorker = window.Worker
      const state = window as typeof window & {
        sdkLanguageWorker?: Worker
        sdkDiagnostics?: unknown
      }
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options)
          if (String(url).includes('/language/clangd-host.js'))
            state.sdkLanguageWorker = this
          this.addEventListener('message', ({ data }) => {
            if (
              data.kind === 'rpc' &&
              data.message.method === 'textDocument/publishDiagnostics'
            )
              state.sdkDiagnostics = data.message.params.diagnostics
          })
        }
      }
    })
    await reloadReady(page)
    const downloadedSdks = new Set<string>()
    const cloudRequests: Array<string> = []
    page.on('request', (request) => {
      if (request.postData()?.includes('programBuild:build'))
        cloudRequests.push(request.url())
      if (/\/(compiler|language)\/.*\.bundle$/.test(request.url()))
        downloadedSdks.add(new URL(request.url()).pathname)
    })
    await createProgram(page, template)
    await page
      .getByRole('button', { name: 'Build program', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Build succeeded', exact: true }),
    ).toBeVisible({ timeout: 240_000 })
    await page.getByRole('button', { name: 'Output', exact: true }).click()
    await expect(
      page.getByRole('dialog', { name: 'Output', exact: true }),
    ).toContainText('bytes in this browser')
    if (template === 'PROS' || template === 'EZ') {
      const artifacts = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('v5x-browser-builds-v2', 1)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        try {
          return await new Promise<Array<{ path: string; size: number }>>(
            (resolve, reject) => {
              const request = db
                .transaction('builds')
                .objectStore('builds')
                .get(location.pathname.split('/').at(-1)!)
              request.onsuccess = () =>
                resolve(
                  request.result.artifacts.map(
                    (artifact: { path: string; bytes: Uint8Array }) => ({
                      path: artifact.path,
                      size: artifact.bytes.length,
                    }),
                  ),
                )
              request.onerror = () => reject(request.error)
            },
          )
        } finally {
          db.close()
        }
      })
      expect(artifacts.map((artifact) => artifact.path)).toEqual([
        'bin/hot.package.bin',
        'bin/cold.package.bin',
      ])
      expect(artifacts.every((artifact) => artifact.size > 0)).toBe(true)
      await page.keyboard.press('Escape')
      await reloadReady(page)
      await expect(
        page.getByRole('button', { name: 'Build restored' }),
      ).toBeEnabled()
      await page
        .getByRole('button', { name: 'Upload to Brain', exact: true })
        .click()
      await expect(
        page
          .getByRole('button', { name: 'Upload to Brain', exact: true })
          .last(),
      ).toBeEnabled()
    }
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('button', { name: 'Format document', exact: true }),
    ).toBeEnabled({ timeout: 120_000 })
    await editor(page).click()
    await page.keyboard.press('ControlOrMeta+a')
    const source = '#include <vector>\nvoid browser_headers_check() { std::vec'
    await page.keyboard.insertText(source)
    await expect(editor(page)).toContainText('std::vec')
    const labels = await page.evaluate(async (contents) => {
      const state = window as typeof window & {
        sdkLanguageWorker?: Worker
        sdkDiagnostics?: unknown
      }
      const worker = state.sdkLanguageWorker!
      // Probe the application's real language worker with a known document and
      // cursor, independent of completion-popup focus and caret timing.
      worker.postMessage({ kind: 'files', files: { 'src/main.cpp': contents } })
      worker.postMessage({
        kind: 'rpc',
        message: {
          jsonrpc: '2.0',
          method: 'textDocument/didClose',
          params: {
            textDocument: { uri: 'file:///workspace/src/main.cpp' },
          },
        },
      })
      worker.postMessage({
        kind: 'rpc',
        message: {
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              uri: 'file:///workspace/src/main.cpp',
              languageId: 'cpp',
              version: 10000,
              text: contents,
            },
          },
        },
      })
      return await new Promise<Array<string>>((resolve, reject) => {
        const timer = setTimeout(() => {
          worker.removeEventListener('message', receive)
          reject(new Error('SDK completion timed out'))
        }, 30000)
        const receive = ({ data }: MessageEvent) => {
          if (data.kind !== 'rpc' || data.message.id !== 1000000) return
          clearTimeout(timer)
          worker.removeEventListener('message', receive)
          if (data.message.error) reject(new Error(data.message.error.message))
          else
            resolve(
              (data.message.result?.items ?? data.message.result ?? []).map(
                (item: { label: string }) => item.label,
              ),
            )
        }
        worker.addEventListener('message', receive)
        worker.postMessage({
          kind: 'rpc',
          message: {
            jsonrpc: '2.0',
            id: 1000000,
            method: 'textDocument/completion',
            params: {
              textDocument: { uri: 'file:///workspace/src/main.cpp' },
              position: { line: 1, character: contents.split('\n')[1].length },
              context: { triggerKind: 1 },
            },
          },
        })
      })
    }, source)
    const diagnostics = await page.evaluate(
      () =>
        (window as typeof window & { sdkDiagnostics?: unknown }).sdkDiagnostics,
    )
    expect(labels, JSON.stringify(diagnostics)).toContainEqual(
      expect.stringMatching(/\bvector\b/),
    )
    expect(cloudRequests).toEqual([])
    if (template === 'PROS' || template === 'EZ')
      expect(
        [...downloadedSdks].filter((url) => /\/vexcode-/.test(url)),
      ).toEqual([])
  })
}

test('a cached project compiles with the network disabled', async ({
  programPage: page,
}) => {
  test.setTimeout(300_000)
  await page.getByRole('button', { name: 'Build program', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Build succeeded', exact: true }),
  ).toBeVisible({
    timeout: 240_000,
  })
  await page.context().setOffline(true)
  await page
    .getByRole('button', { name: 'Build succeeded', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Build succeeded', exact: true }),
  ).toBeVisible({
    timeout: 240_000,
  })
  await page.getByRole('button', { name: 'Output', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Output', exact: true }),
  ).toContainText('bytes in this browser')
})

test('report compiler failures and retain the compiler output', async ({
  programPage: page,
}) => {
  test.setTimeout(300_000)
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.insertText('#error Playwright deliberate build failure\n')
  await commitChanges(page)
  await expect(
    page.getByRole('button', { name: 'Commit changes', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Build program', exact: true }).click()
  await expect(
    page.getByRole('button', { name: /^Build failed \(exit code/ }),
  ).toBeVisible({
    timeout: 240_000,
  })
  await page.getByRole('button', { name: 'Output', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Output', exact: true }),
  ).toContainText('Playwright deliberate build failure')
})

test('EZ reuses unchanged objects and the cold package after a source edit', async ({
  signedInPage: page,
}) => {
  test.setTimeout(300_000)
  await createProgram(page, 'EZ')
  const timings: Record<string, number> = {}
  const build = async (label: string) => {
    const started = Date.now()
    await page
      .getByRole('button', {
        name: /^(Build program|Build succeeded|Build restored)$/,
      })
      .click()
    await expect(
      page.getByRole('button', { name: 'Build succeeded', exact: true }),
    ).toBeVisible({ timeout: 240_000 })
    timings[label] = Date.now() - started
  }
  await build('first')
  await build('repeat')
  await page.getByRole('button', { name: 'Output', exact: true }).click()
  const output = page.getByRole('dialog', { name: 'Output', exact: true })
  await expect(output).toContainText('Reused src/main.cpp.o.')
  await expect(output).toContainText('Reused src/autons.cpp.o.')
  await expect(output).toContainText('Reused cold SDK package.')
  await page.keyboard.press('Escape')
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('\nint browser_speed_check = 1;\n')
  await commitChanges(page)
  await build('formatting commit')
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('\nint browser_speed_check_second = 2;\n')
  await commitChanges(page)
  await build('source edit')
  await page.getByRole('button', { name: 'Output', exact: true }).click()
  await expect(output).toContainText('Reused src/autons.cpp.o.')
  await expect(output).toContainText('Reused cold SDK package.')
  await expect(output).not.toContainText('Reused src/main.cpp.o.')
  console.log('EZ browser build timings (ms):', JSON.stringify(timings))
})

test('a corrupt optional PCH falls back and recovers after a restored build', async ({
  signedInPage: page,
}) => {
  test.setTimeout(300_000)
  await createProgram(page, 'EZ')
  await page.getByRole('button', { name: 'Build program', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Build succeeded', exact: true }),
  ).toBeVisible({
    timeout: 240_000,
  })
  await page.evaluate(async () => {
    const cache = await caches.open('v5x-browser-build-assets-v1')
    for (const key of await cache.keys()) {
      if (/ez-pch-.*\.pch\.bundle$/.test(key.url))
        await cache.put(key, new Response('corrupt compiler asset'))
    }
  })
  await reloadReady(page)
  await expect(editor(page)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Build restored' }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Build restored' }).click()
  await expect(
    page.getByRole('button', { name: 'Build succeeded', exact: true }),
  ).toBeVisible({ timeout: 240_000 })
  await page.getByRole('button', { name: 'Output', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Output', exact: true }),
  ).toContainText(
    'Optional precompiled headers unavailable; compiling normally.',
  )
  await page.keyboard.press('Escape')
  await reloadReady(page)
  await expect(editor(page)).toBeVisible()
  await page.getByRole('button', { name: 'Build restored' }).click()
  await expect(
    page.getByRole('button', { name: 'Build succeeded', exact: true }),
  ).toBeVisible({ timeout: 240_000 })
})

test('cancel a browser build and retry with a fresh worker', async ({
  programPage: page,
}) => {
  test.setTimeout(300_000)
  await page.getByRole('button', { name: 'Build program', exact: true }).click()
  const cancel = page.getByRole('button', { name: 'Cancel build', exact: true })
  await expect(cancel).toBeVisible()
  await cancel.click()
  const retry = page.getByRole('button', {
    name: 'Build cancelled',
    exact: true,
  })
  await expect(retry).toBeEnabled()
  await retry.click()
  await expect(
    page.getByRole('button', { name: 'Build succeeded', exact: true }),
  ).toBeEnabled({ timeout: 240_000 })
})
