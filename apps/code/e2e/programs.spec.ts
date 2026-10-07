import { createProgram, editor, expect, test } from './fixtures'

for (const template of ['VEXcode', 'PROS', 'EZ', 'JAR']) {
  test(`create, open and revisit a ${template} program`, async ({
    signedInPage: page,
  }) => {
    await expect(page.locator('a[href^="/p/"]')).toHaveCount(0)
    await createProgram(page, template)
    const url = page.url()
    await page.getByRole('button', { name: 'Back to programs' }).click()
    await expect(page).toHaveURL('/')
    await page.locator('a[href^="/p/"]').click()
    await expect(page).toHaveURL(url)
    await expect(editor(page)).toBeVisible()
  })
}
