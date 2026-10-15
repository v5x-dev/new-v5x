import { appendComment, editor, expect, test } from './fixtures'

;(process.env.BUILD_IDE_SERVICE_FILE ? test : test.skip)(
  'changing the language service preserves the draft and undo history',
  async ({ programPage: page }) => {
    await expect(
      page.getByRole('status', { name: 'C++ ready', exact: true }),
    ).toBeVisible({ timeout: 120_000 })
    const marker = `service-reconnect-${Date.now()}`
    await appendComment(page, marker)
    await page
      .getByRole('button', { name: 'More actions', exact: true })
      .click()
    await page.getByRole('menuitem', { name: /Compilation server/ }).click()
    const dialog = page.getByRole('dialog', {
      name: 'Compilation server',
      exact: true,
    })
    const input = dialog.getByRole('textbox', { name: 'WebSocket URL' })
    const url = new URL(await input.inputValue())
    url.searchParams.set('reconnect', '1')
    await input.fill(url.href)
    const connected = page.waitForEvent(
      'websocket',
      (socket) =>
        new URL(socket.url()).pathname === '/language' &&
        new URL(socket.url()).searchParams.has('reconnect'),
    )
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
    await connected
    await expect(dialog).toBeHidden()
    await expect(
      page.getByRole('status', { name: 'C++ ready', exact: true }),
    ).toBeVisible({ timeout: 120_000 })
    await editor(page).click()
    await page.keyboard.press('ControlOrMeta+End')
    await expect(editor(page)).toContainText(marker)
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor(page)).not.toContainText(marker)
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(editor(page)).toContainText(marker)
  },
)
