import { expect, test } from './fixtures'

for (const kind of ['Bug report', 'Feature request']) {
  test(`submit a ${kind.toLowerCase()}`, async ({ signedInPage: page }) => {
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: 'Feedback', exact: true }).click()
    const dialog = page.getByRole('dialog', {
      name: 'Send feedback',
      exact: true,
    })
    await dialog.getByRole('tab', { name: kind }).click()
    await expect(
      dialog.getByRole('button', { name: 'Send', exact: true }),
    ).toBeDisabled()
    await dialog.getByLabel('Title', { exact: true }).fill(`Playwright ${kind}`)
    await dialog
      .getByLabel('Description', { exact: true })
      .fill('Automated end-to-end test submission.')
    await dialog.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(
      page.getByRole('dialog', { name: 'Feedback sent' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(
      page.getByRole('button', { name: 'Account menu' }),
    ).toBeFocused()
  })
}

test('cancel feedback without submitting', async ({ signedInPage: page }) => {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Feedback', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill('Unsubmitted draft')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeFocused()
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Feedback', exact: true }).click()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    'Unsubmitted draft',
  )
})
