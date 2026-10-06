import { describe, expect, test } from 'bun:test'
import { convexTest } from 'convex-test'
import { internalAction } from '../convex/_generated/server'
import { internal } from '../convex/_generated/api'
import schema from '../convex/schema'

const noop = internalAction({ args: {}, handler: () => null })
const modules = {
  '../convex/_generated/api.ts': () => import('../convex/_generated/api'),
  '../convex/buildPool.ts': () => import('../convex/buildPool'),
  '../convex/programBuildCache.ts': () => import('../convex/programBuildCache'),
  '../convex/buildPoolWorker.ts': () => Promise.resolve({ replenish: noop }),
  '../convex/programBuild.ts': () => Promise.resolve({ deleteMachine: noop }),
}

const slot = { template: 'ez-template', imageTag: 'test-image' }

describe('build worker ownership', () => {
  test('concurrent refill reservations produce only one lease', async () => {
    const t = convexTest(schema, modules)
    const leases = await Promise.all([
      t.mutation(internal.buildPool.reserve, slot),
      t.mutation(internal.buildPool.reserve, slot),
    ])
    expect(leases.filter(Boolean)).toHaveLength(1)
  })

  test('only one overlapping build can take a ready template worker', async () => {
    const t = convexTest(schema, modules)
    const lease = await t.mutation(internal.buildPool.reserve, slot)
    expect(
      await t.mutation(internal.buildPool.publish, {
        ...slot,
        lease: lease!,
        machineId: 'seed-machine',
        commitSha: 'seed-commit',
        expiresAt: Date.now() + 60_000,
      }),
    ).toBe(true)
    const workers = await Promise.all([
      t.mutation(internal.buildPool.take, slot),
      t.mutation(internal.buildPool.take, slot),
    ])
    expect(
      workers
        .filter(Boolean)
        .map((worker) => ({
          machineId: worker!.machineId,
          commitSha: worker!.commitSha,
        })),
    ).toEqual([{ machineId: 'seed-machine', commitSha: 'seed-commit' }])
    await t.finishInProgressScheduledFunctions()
  })

  test('an expired refill cannot replace a newer worker', async () => {
    const t = convexTest(schema, modules)
    const oldLease = await t.mutation(internal.buildPool.reserve, slot)
    await t.run(async (ctx) => {
      const row = await ctx.db.query('buildPool').unique()
      await ctx.db.patch('buildPool', row!._id, { expiresAt: 0 })
    })
    const newLease = await t.mutation(internal.buildPool.reserve, slot)
    expect(newLease).not.toBe(oldLease)
    expect(
      await t.mutation(internal.buildPool.publish, {
        ...slot,
        lease: oldLease!,
        machineId: 'stale-machine',
        commitSha: 'old',
        expiresAt: Date.now() + 60_000,
      }),
    ).toBe(false)
    expect(await t.mutation(internal.buildPool.take, slot)).toBeNull()
  })

  test('expired ready workers never reach a build', async () => {
    const t = convexTest(schema, modules)
    const lease = await t.mutation(internal.buildPool.reserve, slot)
    await t.mutation(internal.buildPool.publish, {
      ...slot,
      lease: lease!,
      machineId: 'expired-machine',
      commitSha: 'old',
      expiresAt: 0,
    })
    expect(await t.mutation(internal.buildPool.take, slot)).toBeNull()
    await t.finishInProgressScheduledFunctions()
  })

  test('incremental worker ownership transfers without losing cached artifacts', async () => {
    const t = convexTest(schema, modules)
    const programId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('program', {
        name: 'test',
        repoId: 'test',
        ownerId: 'test',
        currentCommitSha: 'commit',
      })
      await ctx.db.insert('programBuildCache', {
        programId: id,
        commitSha: 'commit',
        exitCode: 0,
        stdout: 'cached output',
        stderr: '',
        artifacts: [],
        timings: [],
        warmMachineId: 'incremental-machine',
        warmImageTag: slot.imageTag,
        warmExpiresAt: Date.now() + 60_000,
      })
      return id
    })
    const workers = await Promise.all([
      t.mutation(internal.programBuildCache.takeWarmMachine, {
        programId,
        imageTag: slot.imageTag,
      }),
      t.mutation(internal.programBuildCache.takeWarmMachine, {
        programId,
        imageTag: slot.imageTag,
      }),
    ])
    expect(
      workers
        .filter(Boolean)
        .map((worker) => ({
          machineId: worker!.machineId,
          commitSha: worker!.commitSha,
        })),
    ).toEqual([{ machineId: 'incremental-machine', commitSha: 'commit' }])
    const cached = await t.run((ctx) =>
      ctx.db.query('programBuildCache').unique(),
    )
    expect(cached?.stdout).toBe('cached output')
    expect(cached?.warmMachineId).toBeUndefined()
  })
})
