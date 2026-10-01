import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

test('unauthenticated visitors can reach sign-in', async ({ app, screen }) => {
  await app.open('/')
  await expect(screen.getByRole('button', 'Sign in anonymously')).toBeVisible()
})
