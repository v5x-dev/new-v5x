import { editor, expect, test } from './fixtures'

test('member completions follow the caret and accept with Tab', async ({
  programPage: page,
}) => {
  await expect(
    page.getByRole('status', { name: 'C++ ready', exact: true }),
  ).toBeVisible({ timeout: 120_000 })

  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(
    'struct CompletionProbe { int member; void method(); };\n' +
      'void probe() { CompletionProbe value; value.',
  )

  const popup = page.getByRole('listbox', { name: 'Completions' })
  await expect(popup).toBeVisible()
  // clangd can return word suggestions while the first AST is still parsing.
  await expect
    .poll(async () => {
      await page.keyboard.press('ControlOrMeta+Space')
      return popup
        .getByRole('option', { name: 'member int', exact: true })
        .isVisible()
    })
    .toBeTruthy()
  await expect(
    popup.getByRole('option', { name: 'member int', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')

  const caret = page.locator('[data-caret]').filter({ visible: true }).last()
  const caretBounds = await caret.boundingBox()
  const popupBounds = await popup.boundingBox()
  expect(caretBounds).not.toBeNull()
  expect(popupBounds).not.toBeNull()
  expect(Math.abs(popupBounds!.x - caretBounds!.x)).toBeLessThan(2)
  expect(popupBounds!.y).toBeCloseTo(
    caretBounds!.y + caretBounds!.height + 4,
    0,
  )

  await page.keyboard.press('Tab')
  await expect(popup).toBeHidden()
  await expect(editor(page)).toContainText('value.member')

  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+Space')
  await expect(popup).toBeVisible()
  await popup
    .getByRole('option', { name: 'method() void', exact: true })
    .click()
  await expect(popup).toBeHidden()
  await expect(editor(page)).toContainText('value.method()')
})
