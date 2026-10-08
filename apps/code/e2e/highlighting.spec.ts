import { editor, expect, test } from './fixtures'

test('edits retain semantic colors and gutter position between analysis results', async ({
  programPage: page,
}) => {
  await expect(
    page.getByRole('status', { name: 'C++ ready', exact: true }),
  ).toBeVisible({ timeout: 120_000 })

  await editor(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(
    'struct FlickerProbe { int member; };\n' +
      'void probe() {\n  FlickerProbe value;\n  value.member = 1;\n\n}\n',
  )

  const readColors = () =>
    editor(page).evaluate((element) =>
      Array.from(element.querySelectorAll('span'))
        .filter((span) => span.textContent === 'value')
        .map((span) => getComputedStyle(span).color),
    )

  await expect
    .poll(readColors)
    .toEqual(['rgb(230, 225, 196)', 'rgb(230, 225, 196)'])

  await editor(page).evaluate((element) => {
    const state = {
      started: performance.now(),
      samples: [] as Array<{ colors: Array<string>; left: number }>,
      observer: null as MutationObserver | null,
    }
    const root = element.getRootNode() as ShadowRoot
    const sample = () => {
      const content = root.querySelector<HTMLElement>('[data-content]')!
      state.samples.push({
        colors: Array.from(content.querySelectorAll('span'))
          .filter((span) => span.textContent === 'value')
          .map((span) => getComputedStyle(span).color),
        left: content.getBoundingClientRect().left,
      })
    }

    sample()
    state.observer = new MutationObserver(sample)
    state.observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
    })
    Object.assign(window, { highlightingProbe: state })
  })

  // Move tokens to a new line, then back through undo, without waiting for clangd.
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.insertText('// prefix\n')
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('// end\n')

  // Observe the whole debounce interval and the following analysis render.
  await page.waitForFunction(() => {
    const state = (window as any).highlightingProbe
    return performance.now() - state.started > 1000
  })

  const samples = await page.evaluate(() => {
    const state = (window as any).highlightingProbe
    state.observer.disconnect()
    return state.samples as Array<{ colors: Array<string>; left: number }>
  })

  expect(samples.length).toBeGreaterThan(1)
  for (const sample of samples) {
    expect(sample.colors).toEqual(['rgb(230, 225, 196)', 'rgb(230, 225, 196)'])
    expect(sample.left).toBe(samples[0].left)
  }
})
