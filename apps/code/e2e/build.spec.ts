import { commitChanges, editor, expect, reloadReady, test } from './fixtures'

test('build a program, show output, enable upload and restore artifacts on reload', async ({
  programPage: page,
}) => {
  test.setTimeout(300_000)
  const build = page.getByRole('button', { name: 'Build program', exact: true })
  await expect(build).toBeEnabled()
  await build.click()
  await expect(
    page.getByRole('button', { name: /^Building program,/ }),
  ).toBeDisabled()
  await expect(page.getByText('Build succeeded', { exact: true })).toBeVisible({
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
    page.getByRole('button', { name: 'Build already run for this commit' }),
  ).toBeDisabled()
  await page
    .getByRole('button', { name: 'Upload to Brain', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Upload to Brain', exact: true }).last(),
  ).toBeEnabled()
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
  await expect(page.getByText(/^Build failed \(exit code/)).toBeVisible({
    timeout: 240_000,
  })
  await page.getByRole('button', { name: 'Output', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Output', exact: true }),
  ).toContainText('Playwright deliberate build failure')
})
