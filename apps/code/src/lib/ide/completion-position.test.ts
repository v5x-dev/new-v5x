import { expect, test } from 'bun:test'
import { completionPosition } from './completion-position'

const viewport = { width: 800, height: 600 }

test('short completion lists stay directly below the caret', () => {
  expect(
    completionPosition(
      { left: 120, top: 400, bottom: 420 },
      { width: 384, height: 60 },
      viewport,
    ),
  ).toEqual({ left: 120, top: 424, maxHeight: 168 })
})

test('long lists flip above the caret without covering its line', () => {
  expect(
    completionPosition(
      { left: 120, top: 500, bottom: 520 },
      { width: 384, height: 2800 },
      viewport,
    ),
  ).toEqual({ left: 120, top: 208, maxHeight: 288 })
})

test('a capped list fits below when there is enough space', () => {
  expect(
    completionPosition(
      { left: 120, top: 200, bottom: 220 },
      { width: 384, height: 2800 },
      viewport,
    ).top,
  ).toBe(224)
})

test('constrains lists to the larger side and keeps them inside the right edge', () => {
  expect(
    completionPosition(
      { left: 780, top: 290, bottom: 310 },
      { width: 384, height: 2800 },
      viewport,
    ),
  ).toEqual({ left: 408, top: 314, maxHeight: 278 })
})
