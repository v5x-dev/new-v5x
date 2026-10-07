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
    page.getByRole('button', { name: 'Commit changes before building' }),
  ).toBeDisabled()
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
  const problems = page.getByRole('dialog', { name: /^Problems/ })
  await expect(problems).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Output', exact: true }).click()
  const output = page.getByRole('dialog', { name: 'Output', exact: true })
  await expect(output).toContainText(
    'Build the project to see compiler output.',
  )
  await page.keyboard.press('Escape')
  await expect(output).toBeHidden()
})
