import {
  appendComment,
  commitChanges,
  editor,
  expect,
  openFile,
  reloadReady,
  test,
  waitForDraft,
} from './fixtures'

test('edit, undo, redo, recover a draft and commit it', async ({
  programPage: page,
}) => {
  const marker = `draft-${Date.now()}`
  await appendComment(page, marker)
  await expect(
    page.getByRole('button', { name: 'Save and build program' }),
  ).toBeEnabled()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editor(page)).not.toContainText(marker)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(editor(page)).toContainText(marker)
  await waitForDraft(page, marker)
  await reloadReady(page)
  await expect(editor(page)).toContainText(marker)
  await commitChanges(page)
  await expect(
    page.getByRole('button', { name: 'Commit changes', exact: true }),
  ).toBeDisabled()
  await reloadReady(page)
  await expect(editor(page)).toContainText(marker)
  await expect(
    page.getByRole('button', { name: 'Commit changes', exact: true }),
  ).toBeDisabled()
})

test('open files, switch tabs, close and reopen a tab', async ({
  programPage: page,
}) => {
  await openFile(page, 'include/vex.h')
  await expect(
    page.getByRole('tab', { name: 'vex.h', exact: true }),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'main.cpp', exact: true }).click()
  await expect(
    page.getByRole('tab', { name: 'main.cpp', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await page
    .getByRole('button', { name: 'Close include/vex.h', exact: true })
    .click()
  await expect(
    page.getByRole('tab', { name: 'vex.h', exact: true }),
  ).toBeHidden()
  await openFile(page, 'include/vex.h')
})

test('file picker reports no matches and dismisses with Escape', async ({
  programPage: page,
}) => {
  await page.keyboard.press('ControlOrMeta+p')
  const dialog = page.getByRole('dialog', { name: 'Open file', exact: true })
  await dialog.getByRole('combobox').fill('no-such-project-file-12345')
  await expect(dialog.getByText('No matching files.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(editor(page)).toBeVisible()
})

test('search drafts, toggle case matching and navigate to a result', async ({
  programPage: page,
}) => {
  await appendComment(page, 'PlaywrightSearchToken')
  await page
    .getByRole('button', { name: 'Search project', exact: true })
    .click()
  const search = page.getByRole('dialog', {
    name: 'Search project',
    exact: true,
  })
  await search
    .getByRole('textbox', { name: 'Search workspace' })
    .fill('playwrightsearchtoken')
  await expect(search.getByRole('status')).toHaveText('1 matches in 1 files')
  await search.getByRole('button', { name: 'Match case' }).click()
  await expect(search.getByRole('status')).toHaveText('No matches.')
  await search
    .getByRole('textbox', { name: 'Search workspace' })
    .fill('PlaywrightSearchToken')
  await search
    .getByRole('button')
    .filter({ hasText: 'PlaywrightSearchToken' })
    .click()
  await expect(search).toBeHidden()
  await expect(page.getByRole('tab', { name: /main.cpp/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

test('format a document and show problems and compiler output', async ({
  programPage: page,
}) => {
  await expect(
    page.getByRole('button', { name: 'Format document', exact: true }),
  ).toBeEnabled({ timeout: 120_000 })
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('\nint playwright_format=1;\n')
  await page
    .getByRole('button', { name: 'Format document', exact: true })
    .click()
  await expect(editor(page)).toContainText('int playwright_format = 1;')
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+j')
  const problems = page.getByRole('region', { name: /^Problems/ })
  await expect(problems).toBeVisible()
  await problems.getByRole('button', { name: 'Close panel' }).click()
  await page.getByRole('button', { name: 'Output', exact: true }).click()
  const output = page.getByRole('region', { name: 'Output', exact: true })
  await expect(output).toContainText(
    'Build the project to see compiler output.',
  )
  await output.getByRole('button', { name: 'Close panel' }).click()
  await expect(output).toBeHidden()
})

test('cancel leaving a program with uncommitted changes', async ({
  programPage: page,
}) => {
  await appendComment(page, 'guard this draft')
  const url = page.url()
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('uncommitted changes')
    void dialog.dismiss()
  })
  await page
    .getByRole('button', { name: 'Back to programs', exact: true })
    .click()
  await expect(page).toHaveURL(url)
  await expect(editor(page)).toContainText('guard this draft')
})

test('preserve draft and undo after cycling through several editors', async ({
  programPage: page,
}) => {
  const marker = `retained-undo-${Date.now()}`
  await appendComment(page, marker)
  await openFile(page, 'include/vex.h')
  await openFile(page, 'makefile')
  await openFile(page, 'vex/mkenv.mk')
  await openFile(page, 'src/main.cpp')
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await expect(editor(page)).toContainText(marker)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editor(page)).not.toContainText(marker)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(editor(page)).toContainText(marker)
  await page
    .getByRole('button', { name: 'Close src/main.cpp', exact: true })
    .click()
  await openFile(page, 'src/main.cpp')
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await expect(editor(page)).toContainText(marker)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editor(page)).not.toContainText(marker)
})

test('preserve edits made while commit formatting is pending', async ({
  programPage: page,
}) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { formattingPending?: boolean }
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      private formattingIds = new Set<number | string>()
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        let handler: Worker['onmessage'] = null
        Object.defineProperty(this, 'onmessage', {
          get: () => handler,
          set: (next: Worker['onmessage']) => {
            handler = next
          },
        })
        this.addEventListener('message', (event) => {
          if (
            event.data?.kind === 'rpc' &&
            this.formattingIds.delete(event.data.message?.id)
          ) {
            setTimeout(() => handler?.call(this, event), 750)
          } else handler?.call(this, event)
        })
      }
      postMessage(message: any) {
        if (
          message?.kind === 'rpc' &&
          message.message?.method === 'textDocument/formatting'
        ) {
          this.formattingIds.add(message.message.id)
          state.formattingPending = true
        }
        super.postMessage(message)
      }
    }
  })
  await reloadReady(page)
  await expect(
    page.getByRole('status', { name: 'C++ ready', exact: true }),
  ).toBeVisible({ timeout: 120_000 })
  await appendComment(page, 'edit before commit')
  await page
    .getByRole('button', { name: 'Commit changes', exact: true })
    .click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { formattingPending?: boolean })
            .formattingPending,
      ),
    )
    .toBe(true)
  const marker = `edit-during-format-${Date.now()}`
  await appendComment(page, marker)
  await expect(page.getByRole('alert')).toContainText(
    'program changed while formatting',
  )
  await expect(editor(page)).toContainText(marker)
  await expect(
    page.getByRole('button', { name: 'Commit changes', exact: true }),
  ).toBeEnabled()
})

test('long documents keep the caret visible after rapid viewport changes', async ({
  programPage: page,
}) => {
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(
    '// viewport-start\n' +
      Array.from({ length: 2000 }, (_, index) => `// line ${index}\n`).join(
        '',
      ) +
      '// viewport-end',
  )
  await expect(editor(page)).toContainText('// viewport-end')
  await page.keyboard.press('ControlOrMeta+Home')
  await expect(editor(page)).toContainText('// viewport-start')
  await page.mouse.wheel(0, 20_000)
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('-edited')
  await expect(editor(page)).toContainText('// viewport-end-edited')
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.insertText('// first-edit\n')
  await expect(editor(page)).toContainText('// first-edit')
})
