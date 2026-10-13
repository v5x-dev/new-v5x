/// <reference types="vite/client" />
import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import rateLimiterTest from '@convex-dev/rate-limiter/test'
import schema from './schema'
import { internal } from './_generated/api'
import { consumeQuota } from './quotas'

const modules = import.meta.glob('./**/*.ts')
function backend() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  return t
}

test('project quotas deny concurrent excess allocations and isolate accounts', async () => {
  const t = backend()
  const guest = t.withIdentity({ subject: 'guest' })
  const requests = await Promise.allSettled(
    Array.from({ length: 4 }, () =>
      guest.mutation(internal.quotas.consumeProjectCreation, {}),
    ),
  )
  expect(
    requests.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(3)
  expect(
    requests.filter((result) => result.status === 'rejected'),
  ).toHaveLength(1)
  await expect(
    t
      .withIdentity({ subject: 'other' })
      .mutation(internal.quotas.consumeProjectCreation, {}),
  ).resolves.toBeNull()
  await expect(
    t.mutation(internal.quotas.consumeProjectCreation, {}),
  ).rejects.toThrow('Sign in')
})

test('feedback quota limits submissions and global project quota limits replacement guest accounts', async () => {
  const t = backend()
  const guest = t.withIdentity({ subject: 'guest' })
  for (let index = 0; index < 3; index++)
    await guest.run((ctx) => consumeQuota(ctx, 'feedback'))
  await expect(
    guest.run((ctx) => consumeQuota(ctx, 'feedback')),
  ).rejects.toThrow('Too many requests')
  for (let index = 0; index < 20; index++) {
    await t
      .withIdentity({ subject: `new-guest-${index}` })
      .mutation(internal.quotas.consumeProjectCreation, {})
  }
  await expect(
    t
      .withIdentity({ subject: 'another-guest' })
      .mutation(internal.quotas.consumeProjectCreation, {}),
  ).rejects.toThrow('Too many requests')
})
