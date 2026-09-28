'use node'

import { v } from 'convex/values'
import { Machine } from 'smolmachines'
import { api } from './_generated/api'
import { action, env } from './_generated/server'
import { store } from './store'

const DEFAULT_SMOL_CLOUD_URL = 'https://api.smolmachines.com'
const MAX_OUTPUT_BYTES = 400 * 1024

function limitOutput(output: string) {
  const bytes = new TextEncoder().encode(output)
  if (bytes.byteLength <= MAX_OUTPUT_BYTES) return output

  const tail = new TextDecoder().decode(bytes.slice(-MAX_OUTPUT_BYTES))
  return `[Output truncated; showing the last ${MAX_OUTPUT_BYTES} bytes]\n${tail}`
}

export const build = action({
  args: { programId: v.id('program') },
  returns: v.object({
    exitCode: v.number(),
    stdout: v.string(),
    stderr: v.string(),
    binFiles: v.array(v.string()),
  }),
  handler: async (ctx, { programId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')

    const program = await ctx.runQuery(api.program.get, { programId })
    if (!program) throw new Error('Program not found')

    const token = env.SMOL_CLOUD_TOKEN
    if (!token) throw new Error('SMOL_CLOUD_TOKEN is not configured')

    const cloudUrl = (env.SMOL_CLOUD_URL ?? DEFAULT_SMOL_CLOUD_URL).replace(
      /\/+$/,
      '',
    )
    const accountResponse = await fetch(`${cloudUrl}/v1/me`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!accountResponse.ok) {
      throw new Error(
        `Could not resolve Smol registry namespace (${accountResponse.status})`,
      )
    }

    const account: unknown = await accountResponse.json()
    const registryNamespace =
      typeof account === 'object' &&
      account !== null &&
      'registryNamespace' in account &&
      typeof account.registryNamespace === 'string'
        ? account.registryNamespace
        : null
    if (!registryNamespace?.startsWith('tenants/')) {
      throw new Error('Smol account has no registry namespace')
    }

    const machine = await Machine.create(
      {
        image: `registry.smolmachines.com/${registryNamespace}/vexcode:v1`,
        resources: { cpus: 2, memoryMb: 2048, network: true },
        ttlSeconds: 900,
      },
      { target: 'cloud', apiKey: token, baseUrl: cloudUrl },
    )

    try {
      const repo = store.repo({ id: program.repoId })
      const remoteUrl = await repo.getRemoteURL({
        permissions: ['git:read'],
        ttl: 900,
      })
      const clone = await machine.exec(
        ['git', 'clone', remoteUrl, '/workspace'],
        { timeout: 120 },
      )
      if (clone.exitCode !== 0) {
        // The clone URL contains a short-lived repository credential. Keep it
        // and any URL echoed by git out of action errors returned to the client.
        throw new Error(
          `Unable to clone program repository (${clone.exitCode})`,
        )
      }

      const result = await machine.exec(['make'], {
        workdir: '/workspace',
        env: { VEX_SDK_PATH: '/sdk' },
        timeout: 300,
      })
      let binFiles: string[] = []
      if (result.exitCode === 0) {
        const binaries = await machine.exec(
          ['find', 'build', '-type', 'f', '-name', '*.bin'],
          { workdir: '/workspace', timeout: 30 },
        )
        if (binaries.exitCode === 0) {
          binFiles = binaries.stdout
            .split(/\r?\n/)
            .filter(
              (path) =>
                path.startsWith('build/') &&
                path.endsWith('.bin') &&
                !path.split('/').some((segment) => segment === '..'),
            )
            .slice(0, 100)
        }
      }

      return {
        exitCode: result.exitCode,
        stdout: limitOutput(result.stdout),
        stderr: limitOutput(result.stderr),
        binFiles,
      }
    } finally {
      await machine.delete()
    }
  },
})
