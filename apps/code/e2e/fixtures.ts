import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Every test gets a new real Better Auth user. Cookies stay in its browser
// context, so SSR, the auth client, and Convex all exercise normal auth paths.
export const test = base.extend<{ signedInPage: Page; programPage: Page }>({
  signedInPage: async ({ page, baseURL }, use) => {
    const response = await page.request.post('/api/auth/sign-in/anonymous', {
      headers: { Origin: baseURL! },
      data: {},
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    await gotoReady(page, '/')
    await expect(
      page.getByRole('button', { name: 'Account menu' }),
    ).toBeVisible()
    await use(page)
  },
  programPage: async ({ signedInPage: page }, use) => {
    await createProgram(page, 'VEXcode')
    await use(page)
  },
})

export { expect }

export async function createProgram(page: Page, template: string) {
  const existing = new Set(
    await page
      .locator('a[href^="/p/"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
  )
  await page.getByRole('button', { name: template, exact: true }).click()
  const link = page.locator('a[href^="/p/"]')
  await expect
    .poll(async () =>
      link.evaluateAll(
        (links, before) =>
          links
            .map((item) => item.getAttribute('href'))
            .find((href) => !before.includes(href)),
        [...existing],
      ),
    )
    .toBeTruthy()
  const createdHref = await link.evaluateAll(
    (links, before) =>
      links
        .map((item) => item.getAttribute('href'))
        .find((href) => !before.includes(href)),
    [...existing],
  )
  const created = page.locator(`a[href="${createdHref}"]`)
  await expect(
    created
      .locator('xpath=ancestor::li')
      .getByRole('img', { name: template, exact: true }),
  ).toBeVisible()
  await created.click()
  await expect(page).toHaveURL(/\/p\/[^/]+$/)
  await expect(editor(page)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Commit changes', exact: true }),
  ).toBeDisabled()
}

export function editor(page: Page) {
  // Playwright pierces Pierre's open shadow roots. Inactive file editors are
  // aria-hidden, so role lookup selects the currently displayed document.
  return page.getByRole('textbox').filter({ visible: true })
}

export async function openFile(page: Page, path: string) {
  await page.keyboard.press('ControlOrMeta+p')
  const dialog = page.getByRole('dialog', { name: 'Open file', exact: true })
  await dialog.getByRole('combobox').fill(path)
  await dialog.getByRole('option', { name: path, exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(
    page.getByRole('tab').filter({ hasText: path.split('/').at(-1)! }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(editor(page)).toBeVisible()
}

export async function appendComment(page: Page, comment: string) {
  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText(`\n// ${comment}\n`)
  await expect(
    page.getByRole('button', { name: 'Commit changes', exact: true }),
  ).toBeEnabled()
}

export async function gotoReady(page: Page, path: string) {
  // SSR exposes buttons before React attaches handlers. The session request
  // starts from the mounted auth provider and is an observable hydration signal.
  const session = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/get-session',
  )
  await page.goto(path)
  await session
}

export async function reloadReady(page: Page) {
  const session = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/get-session',
  )
  await page.reload()
  await session
}

export async function commitChanges(page: Page) {
  await expect(
    page.getByRole('status', { name: 'C++ ready', exact: true }),
  ).toBeVisible({ timeout: 120_000 })
  const commit = page.getByRole('button', {
    name: 'Commit changes',
    exact: true,
  })
  await expect(commit).toBeEnabled()
  await commit.click()
  await expect(commit).toBeDisabled()
  await expect(
    page
      .getByRole('tablist', { name: 'Open files' })
      .getByLabel('Unsaved changes'),
  ).toHaveCount(0)
}

export async function waitForDraft(page: Page, marker: string) {
  // Recovery is durable only after the debounced IndexedDB transaction ends.
  // Read the stored draft rather than racing a reload against that transaction.
  const programId = new URL(page.url()).pathname.split('/').at(-1)!
  await expect
    .poll(() =>
      page.evaluate(
        ({ key, text }) =>
          new Promise<boolean>((resolve, reject) => {
            const open = indexedDB.open('v5x-code-workspaces', 1)
            open.onerror = () => reject(open.error)
            open.onsuccess = () => {
              const database = open.result
              if (!database.objectStoreNames.contains('workspaces')) {
                database.close()
                resolve(false)
                return
              }
              const read = database
                .transaction('workspaces')
                .objectStore('workspaces')
                .get(key)
              read.onsuccess = () => {
                const stored = read.result as
                  | { documents?: Record<string, { contents: string }> }
                  | undefined
                database.close()
                resolve(
                  stored?.documents?.['src/main.cpp']?.contents.includes(
                    text,
                  ) ?? false,
                )
              }
              read.onerror = () => {
                database.close()
                reject(read.error)
              }
            }
          }),
        { key: programId, text: marker },
      ),
    )
    .toBe(true)
}
