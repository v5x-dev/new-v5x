import { commitChanges, editor, expect, reloadReady, test } from './fixtures'
import type { Page } from '@playwright/test'

function item(page: Page, path: string) {
  return page.locator(
    `[role="treeitem"]:is([data-item-path="${path}"], [data-item-path="${path}/"])`,
  )
}

async function menu(page: Page, path: string, action: string) {
  await item(page, path).click({ button: 'right' })
  await page
    .getByRole('menuitem', {
      name: action === 'Rename' ? /^Rename/ : action,
      exact: true,
    })
    .click()
}

async function renameInput(page: Page, name: string) {
  const input = page.locator('[data-item-rename-input]')
  await input.fill(name)
  await input.press('Enter')
  await expect(input).toBeHidden()
}

test('create a file, rename, duplicate, download and delete it', async ({
  programPage: page,
}) => {
  await menu(page, 'src/main.cpp', 'New file')
  await renameInput(page, 'e2e.cpp')
  await expect(item(page, 'src/e2e.cpp')).toBeVisible()
  await item(page, 'src/e2e.cpp').click()
  await expect(editor(page)).toBeVisible()
  await page.keyboard.insertText('// File operation test\n')
  await menu(page, 'src/e2e.cpp', 'Rename')
  await renameInput(page, 'renamed.cpp')
  await expect(item(page, 'src/e2e.cpp')).toBeHidden()
  await menu(page, 'src/renamed.cpp', 'Duplicate...')
  const duplicate = page.getByRole('dialog', { name: 'Duplicate', exact: true })
  await duplicate.getByLabel('Destination path').fill('src/copied.cpp')
  await duplicate
    .getByRole('button', { name: 'Duplicate', exact: true })
    .click()
  await expect(item(page, 'src/copied.cpp')).toBeVisible()
  const download = page.waitForEvent('download')
  await menu(page, 'src/copied.cpp', 'Download')
  expect((await download).suggestedFilename()).toBe('copied.cpp')
  await menu(page, 'src/copied.cpp', 'Delete...')
  const deletion = page.getByRole('dialog', { name: 'Delete copied.cpp?' })
  await deletion.getByRole('button', { name: 'Cancel' }).click()
  await expect(item(page, 'src/copied.cpp')).toBeVisible()
  await menu(page, 'src/copied.cpp', 'Delete...')
  await deletion.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(item(page, 'src/copied.cpp')).toBeHidden()
  await commitChanges(page)
  await expect(
    page.getByRole('button', { name: 'Commit changes', exact: true }),
  ).toBeDisabled()
  await reloadReady(page)
  await expect(item(page, 'src/renamed.cpp')).toBeVisible()
  await expect(item(page, 'src/copied.cpp')).toBeHidden()
})

test('create a folder and move files using cut and paste', async ({
  programPage: page,
}) => {
  await menu(page, 'src/main.cpp', 'New folder')
  await renameInput(page, 'e2e-folder')
  await expect(item(page, 'src/e2e-folder')).toBeVisible()
  await menu(page, 'src/main.cpp', 'New file')
  await renameInput(page, 'move.cpp')
  await menu(page, 'src/move.cpp', 'Copy')
  await menu(page, 'src/e2e-folder', 'Paste')
  await expect(item(page, 'src/move.cpp')).toBeVisible()
  await expect(item(page, 'src/e2e-folder/move.cpp')).toBeVisible()
  await menu(page, 'src/move.cpp', 'Rename')
  await renameInput(page, 'cut.cpp')
  await menu(page, 'src/cut.cpp', 'Cut')
  await menu(page, 'src/e2e-folder', 'Paste')
  await expect(item(page, 'src/cut.cpp')).toBeHidden()
  await expect(item(page, 'src/e2e-folder/cut.cpp')).toBeVisible()
  await commitChanges(page)
  await expect(
    page.getByRole('button', { name: 'Commit changes', exact: true }),
  ).toBeDisabled()
  await reloadReady(page)
  await expect(item(page, 'src/e2e-folder')).toBeVisible()
})
