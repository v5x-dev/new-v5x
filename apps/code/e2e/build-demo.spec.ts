import { expect, test } from '@playwright/test'

for (const template of ['vexcode', 'pros', 'ez-template', 'jar-template']) {
  test(`public browser build demo compiles ${template}`, async ({ page }) => {
    await page.goto('/build-demo')
    await expect(
      page.getByRole('heading', { name: 'Browser build', exact: true }),
    ).toBeVisible()
    await page.getByLabel('Template', { exact: true }).selectOption(template)
    await page
      .getByRole('button', { name: 'Build in browser', exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText('Build succeeded', {
      timeout: 110_000,
    })
    const downloads = page.getByRole('button', { name: /^Download / })
    await expect(downloads).toHaveCount(
      template === 'pros' || template === 'ez-template' ? 2 : 1,
    )
    const pending = page.waitForEvent('download')
    await downloads.first().click()
    const artifact = await pending
    expect(artifact.suggestedFilename()).toMatch(/\.bin$/)
    expect(await artifact.failure()).toBeNull()
    if (template === 'ez-template') {
      await page
        .getByRole('button', { name: 'Build in browser', exact: true })
        .click()
      await expect(page.getByRole('status')).toContainText('Build succeeded', {
        timeout: 110_000,
      })
      await expect(downloads).toHaveCount(2)
      await page.getByRole('button', { name: 'Reset source' }).click()
      await expect(downloads).toHaveCount(0)
      await expect(page.getByRole('status')).toHaveText('Ready')
    }
  })
}

test('edited source errors appear and reset recovers', async ({ page }) => {
  await page.goto('/build-demo')
  await page.getByLabel('Template', { exact: true }).selectOption('vexcode')
  await page.getByRole('textbox').filter({ visible: true }).click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.insertText('#error demo deliberate failure\n')
  await page
    .getByRole('button', { name: 'Build in browser', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText('Build failed')
  await expect(page.getByTestId('build-output')).toContainText(
    'demo deliberate failure',
  )
  await expect(page.getByRole('button', { name: /^Download / })).toHaveCount(0)
  await page.getByRole('button', { name: 'Reset source' }).click()
  await page
    .getByRole('button', { name: 'Build in browser', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText('Build succeeded')
})
