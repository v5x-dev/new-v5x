import { expect, test } from './fixtures'

test('choose an upload slot and require a build before uploading', async ({
  programPage: page,
}) => {
  await page
    .getByRole('button', { name: 'Upload to Brain', exact: true })
    .click()
  const slots = page.getByRole('group', { name: 'Brain slot' })
  await expect(
    slots.getByRole('button', { name: '1', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await slots.getByRole('button', { name: '8', exact: true }).click()
  await expect(
    slots.getByRole('button', { name: '8', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    slots.getByRole('button', { name: '1', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false')
  await expect(
    page.getByText('Build the program before uploading.', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Upload to Brain', exact: true }).last(),
  ).toBeDisabled()
})

test('disconnected terminal disables input and handles a cancelled connection', async ({
  programPage: page,
}) => {
  // Keep the app's adapter and error handling; replace only the hardware chooser.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: () =>
          Promise.reject(new DOMException('No port selected', 'NotFoundError')),
        getPorts: () => Promise.resolve([]),
      },
    })
  })
  await page
    .getByRole('button', { name: 'Brain terminal', exact: true })
    .click()
  const terminal = page.getByRole('dialog', {
    name: 'Brain terminal',
    exact: true,
  })
  await expect(terminal.getByRole('status')).toHaveText('Disconnected')
  await expect(
    terminal.getByRole('textbox', { name: 'Brain terminal input' }),
  ).toBeDisabled()
  await expect(
    terminal.getByRole('button', { name: 'Send input' }),
  ).toBeDisabled()
  await terminal.getByRole('button', { name: 'Connect Brain' }).click()
  await expect(terminal.getByRole('alert')).toContainText('No port selected')
  await expect(
    terminal.getByRole('button', { name: 'Connect Brain' }),
  ).toBeEnabled()
  await terminal.getByRole('button', { name: 'Clear output' }).click()
  await expect(terminal.getByLabel('Brain terminal output')).toContainText(
    'Waiting for program output',
  )
  await terminal.getByRole('button', { name: 'Close terminal' }).click()
  await expect(terminal).toBeHidden()
})
