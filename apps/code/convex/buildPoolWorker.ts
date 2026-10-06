'use node'

import { internal } from './_generated/api'
import { env, internalAction } from './_generated/server'
import { templateFiles } from './template'
import { prepareBuildSdk, preparePrecompiledHeader } from './lib/buildSdk'
import {
  BUILD_GIT_ENV,
  BUILD_MACHINE_TTL_SECONDS,
  DEFAULT_BUILD_IMAGE_TAG,
  DEFAULT_SMOL_CLOUD_URL,
  createBuildMachine,
  resolveBuildCloud,
} from './lib/buildCloud'
import type { Machine } from 'smolmachines'

export const replenish = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!env.SMOL_CLOUD_TOKEN) return
    const token = env.SMOL_CLOUD_TOKEN
    const cloudUrl = (env.SMOL_CLOUD_URL ?? DEFAULT_SMOL_CLOUD_URL).replace(
      /\/+$/,
      '',
    )
    const imageTag = env.VEXCODE_IMAGE_TAG ?? DEFAULT_BUILD_IMAGE_TAG
    const namespace = await resolveBuildCloud(token, cloudUrl)
    const fills = await Promise.allSettled(
      Object.entries(templateFiles).map(async ([template, files]) => {
        const lease: string | null = await ctx.runMutation(
          internal.buildPool.reserve,
          { template, imageTag },
        )
        if (!lease) return
        let machine: Machine | null = null
        let retained = false
        const started = Date.now()
        try {
          machine = await createBuildMachine(
            namespace,
            imageTag,
            token,
            cloudUrl,
          )
          const directories = [
            ...new Set(
              Object.keys(files).map(
                (path) =>
                  `/workspace/${path.split('/').slice(0, -1).join('/')}`,
              ),
            ),
          ]
          const mkdir = await machine.exec(['mkdir', '-p', ...directories])
          if (mkdir.exitCode !== 0)
            throw new Error('Cannot create template directories')
          const writes = await Promise.allSettled(
            Object.entries(files).map(([path, content]) =>
              machine!.writeFile(`/workspace/${path}`, content),
            ),
          )
          const failed = writes.find((result) => result.status === 'rejected')
          if (failed?.status === 'rejected') throw failed.reason
          // The seed index lets git checkout retain timestamps for unchanged files,
          // so make can reuse the template's object files without trusting a cache key.
          const prepared = await machine.exec(
            [
              'sh',
              '-c',
              [
                'set -eu',
                'git init -q',
                'git add .',
                'git -c user.name=build-pool -c user.email=build@example.invalid commit -qm "Template seed"',
                'git remote add origin https://invalid.invalid/v5x-build-cache',
                prepareBuildSdk,
                preparePrecompiledHeader,
                'make -j8 P=workspace',
                'git rev-parse HEAD',
              ].join('\n'),
            ],
            {
              workdir: '/workspace',
              env: { ...BUILD_GIT_ENV, VEX_SDK_PATH: '/sdk' },
              timeout: 240,
            },
          )
          if (prepared.exitCode !== 0)
            throw new Error(`Template ${template} failed: ${prepared.stderr}`)
          const commitSha = prepared.stdout.trim().split(/\r?\n/).at(-1)!
          retained = await ctx.runMutation(internal.buildPool.publish, {
            template,
            imageTag,
            lease,
            machineId: machine.id,
            commitSha,
            expiresAt: started + (BUILD_MACHINE_TTL_SECONDS - 60) * 1000,
          })
        } finally {
          if (!retained) {
            await machine?.delete()
            await ctx.runMutation(internal.buildPool.release, {
              template,
              imageTag,
              lease,
            })
          }
        }
      }),
    )
    for (const fill of fills)
      if (fill.status === 'rejected')
        console.error('Build pool refill failed', fill.reason)
  },
})
