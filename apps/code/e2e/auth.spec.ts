import { expect, gotoReady, reloadReady, test } from './fixtures'

for (const path of ['/', '/p/not-a-program']) {
  test(`signed-out visitors to ${path} reach login`, async ({ page }) => {
    await gotoReady(page, path)
    await expect(page).toHaveURL('/login')
    await expect(
      page.getByRole('button', { name: 'Sign in with Google' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Sign in anonymously' }),
    ).toBeVisible()
  })
}

test('anonymous login survives reload and logout revokes access', async ({
  page,
}) => {
  await gotoReady(page, '/login')
  await page.getByRole('button', { name: 'Sign in anonymously' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible()
  await reloadReady(page)
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click()
  await expect(page).toHaveURL('/login')
  await gotoReady(page, '/')
  await expect(page).toHaveURL('/login')
})

test('login displays auth errors and permits retry', async ({ page }) => {
  await gotoReady(page, '/login')
  await page.route('**/api/auth/sign-in/anonymous', (route) =>
    route.fulfill({
      status: 500,
      json: { code: 'TEST_ERROR', message: 'Sign-in temporarily unavailable' },
    }),
  )
  await page.getByRole('button', { name: 'Sign in anonymously' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'Sign-in temporarily unavailable',
  )
  await page.unroute('**/api/auth/sign-in/anonymous')
  await page.getByRole('button', { name: 'Sign in anonymously' }).click()
  await expect(page).toHaveURL('/')
})

test('Google sign-in requests the provider and homepage callback', async ({
  page,
}) => {
  await gotoReady(page, '/login')
  await page.route('**/api/auth/sign-in/social', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      provider: 'google',
      callbackURL: new URL('/', page.url()).href,
    })
    await route.fulfill({
      status: 400,
      json: { message: 'OAuth test boundary' },
    })
  })
  await page.getByRole('button', { name: 'Sign in with Google' }).click()
  await expect(page.getByRole('alert')).toHaveText('OAuth test boundary')
})

test('failed logout keeps the session and allows retry', async ({
  signedInPage: page,
}) => {
  await page.route('**/api/auth/sign-out', (route) =>
    route.fulfill({
      status: 500,
      json: { message: 'Unavailable' },
    }),
  )
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'Unable to sign out. Try again.',
  )
  await page.unroute('**/api/auth/sign-out')
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click()
  await expect(page).toHaveURL('/login')
})
