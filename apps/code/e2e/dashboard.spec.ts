import { createProgram, expect, gotoReady, reloadReady, test } from './fixtures'

test('dashboard searches real programs and remembers stars after reload', async ({
  signedInPage: page,
}) => {
  await expect(page.getByText('No programs yet', { exact: true })).toBeVisible()
  await createProgram(page, 'VEXcode')
  await page.getByRole('button', { name: 'Back to programs' }).click()

  const program = page.locator('main a[href^="/p/"]')
  const name = (await program.textContent())!.trim()
  const search = page.getByRole('textbox', { name: 'Search programs' })
  await page.keyboard.press('/')
  await expect(search).toBeFocused()
  await search.fill('no-program-matches-this-query')
  await expect(program).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(program).toHaveText(name)

  await page.getByRole('button', { name: 'Star program', exact: true }).click()
  await reloadReady(page)
  await expect(
    page.getByRole('button', { name: 'Unstar program' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Starred', exact: true }).click()
  await expect(program).toHaveText(name)
  await page.getByRole('button', { name: 'Unstar program' }).click()
  await expect(page.getByText('No starred programs yet')).toBeVisible()
  await page.getByRole('button', { name: 'Starred', exact: true }).click()
  await page.getByRole('button', { name: 'Newest', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Name', exact: true }).click()
  await expect(program).toHaveText(name)
})

test('the former lab dashboard route no longer exists', async ({
  signedInPage: page,
}) => {
  await gotoReady(page, '/lab/dashboard')
  await expect(page.getByText('Route not found', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Create a new program' }),
  ).toHaveCount(0)
})
