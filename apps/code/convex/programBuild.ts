'use node'

import { v } from 'convex/values'
import { Machine } from 'smolmachines'
import { api, internal } from './_generated/api'
import { action, env, internalAction } from './_generated/server'
import { store } from './store'

const DEFAULT_SMOL_CLOUD_URL = 'https://api.smolmachines.com'
const MAX_OUTPUT_BYTES = 400 * 1024
const BUILD_ARTIFACT_TTL_MS = 15 * 60 * 1000
const PROS_KERNEL_URL =
  'https://pros.cs.purdue.edu/v5/_static/releases/kernel@3.8.3.zip'
const PROS_KERNEL_SHA256 =
  'fa0eddc8c9493ba1fca73ff7648227f8e84ec1784627f22e37a55445e5f2ecc8'
const PROS_KERNEL_ARCHIVE = '/tmp/pros-kernel-3.8.3.zip'
const EZ_TEMPLATE_PROJECT_URL =
  'https://github.com/EZ-Robotics/EZ-Template/releases/download/v3.2.2/EZ-Template-Example-Project.zip'
const EZ_TEMPLATE_PROJECT_SHA256 =
  '41ec47dc65588cf7efae84771965a4803611f5db88ed5465bbb829a5eb8d7822'
const EZ_TEMPLATE_PROJECT_ARCHIVE =
  '/tmp/ez-template-example-project-3.2.2.zip'

const prepareProsBuild = [
  'set -eu',
  'command -v arm-none-eabi-gcc >/dev/null 2>&1 || { echo "PROS image is missing arm-none-eabi-gcc." >&2; exit 127; }',
  'command -v arm-none-eabi-g++ >/dev/null 2>&1 || { echo "PROS image is missing arm-none-eabi-g++." >&2; exit 127; }',
  'command -v wget >/dev/null 2>&1 || { echo "PROS image is missing wget." >&2; exit 127; }',
  'command -v unzip >/dev/null 2>&1 || { echo "PROS image is missing unzip." >&2; exit 127; }',
  'command -v sha256sum >/dev/null 2>&1 || { echo "PROS image is missing sha256sum." >&2; exit 127; }',
  'stdlib_path=$(arm-none-eabi-g++ -print-file-name=libstdc++.a)',
  '[ -f "$stdlib_path" ] || { echo "PROS image is missing the ARM C++ standard library." >&2; exit 127; }',
  `wget -q -O '${PROS_KERNEL_ARCHIVE}' '${PROS_KERNEL_URL}'`,
  `printf '%s  %s\\n' '${PROS_KERNEL_SHA256}' '${PROS_KERNEL_ARCHIVE}' | sha256sum --check -`,
  `unzip -n -q '${PROS_KERNEL_ARCHIVE}' -d '/workspace'`,
].join('\n')

const prepareEzTemplateBuild = [
  'set -eu',
  'command -v arm-none-eabi-gcc >/dev/null 2>&1 || { echo "PROS image is missing arm-none-eabi-gcc." >&2; exit 127; }',
  'command -v arm-none-eabi-g++ >/dev/null 2>&1 || { echo "PROS image is missing arm-none-eabi-g++." >&2; exit 127; }',
  'command -v wget >/dev/null 2>&1 || { echo "PROS image is missing wget." >&2; exit 127; }',
  'command -v unzip >/dev/null 2>&1 || { echo "PROS image is missing unzip." >&2; exit 127; }',
  'command -v sha256sum >/dev/null 2>&1 || { echo "PROS image is missing sha256sum." >&2; exit 127; }',
  'stdlib_path=$(arm-none-eabi-g++ -print-file-name=libstdc++.a)',
  '[ -f "$stdlib_path" ] || { echo "PROS image is missing the ARM C++ standard library." >&2; exit 127; }',
  `wget -q -O '${EZ_TEMPLATE_PROJECT_ARCHIVE}' '${EZ_TEMPLATE_PROJECT_URL}'`,
  `printf '%s  %s\\n' '${EZ_TEMPLATE_PROJECT_SHA256}' '${EZ_TEMPLATE_PROJECT_ARCHIVE}' | sha256sum --check -`,
  `unzip -n -q '${EZ_TEMPLATE_PROJECT_ARCHIVE}' 'common.mk' 'firmware/*' 'include/*' -d '/workspace'`,
].join('\n')

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
    artifacts: v.array(
      v.object({
        path: v.string(),
        url: v.string(),
      }),
    ),
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

      let setupStdout = ''
      let setupStderr = ''
      const prosProject = await machine.exec(['test', '-f', 'project.pros'], {
        workdir: '/workspace',
        timeout: 10,
      })
      if (prosProject.exitCode === 0) {
        const ezTemplate = await machine.exec(['test', '-f', '.ez-template'], {
          workdir: '/workspace',
          timeout: 10,
        })
        const setupScript =
          ezTemplate.exitCode === 0 ? prepareEzTemplateBuild : prepareProsBuild
        const setup = await machine.exec(['sh', '-lc', setupScript], {
          workdir: '/workspace',
          timeout: 240,
        })
        setupStdout = setup.stdout
        setupStderr = setup.stderr
        if (setup.exitCode !== 0) {
          return {
            exitCode: setup.exitCode,
            stdout: limitOutput(setup.stdout),
            stderr: limitOutput(setup.stderr),
            binFiles: [],
            artifacts: [],
          }
        }
      }

      const result = await machine.exec(['make'], {
        workdir: '/workspace',
        env: { VEX_SDK_PATH: '/sdk' },
        timeout: 300,
      })
      let binFiles: string[] = []
      const artifacts: Array<{ path: string; url: string }> = []
      if (result.exitCode === 0) {
        const binaries = await machine.exec(
          [
            'find',
            '.',
            '-type',
            'f',
            '-name',
            '*.bin',
            '-not',
            '-path',
            './.git/*',
          ],
          { workdir: '/workspace', timeout: 30 },
        )
        if (binaries.exitCode === 0) {
          binFiles = binaries.stdout
            .split(/\r?\n/)
            .filter(
              (path) =>
                (path.startsWith('./build/') || path.startsWith('./bin/')) &&
                path.endsWith('.bin') &&
                !path.split('/').some((segment) => segment === '..'),
            )
            .map((path) => path.slice(2))
            .slice(0, 100)
        }

        for (const path of binFiles) {
          const file = await machine.readFile(`/workspace/${path}`)
          const bytes = new Uint8Array(file.byteLength)
          bytes.set(file)
          const storageId = await ctx.storage.store(
            new Blob([bytes.buffer], { type: 'application/octet-stream' }),
          )
          const url = await ctx.storage.getUrl(storageId)
          if (url === null) {
            await ctx.storage.delete(storageId)
            throw new Error(`Unable to load build artifact ${path}`)
          }
          await ctx.scheduler.runAfter(
            BUILD_ARTIFACT_TTL_MS,
            internal.programBuild.deleteArtifact,
            { storageId },
          )
          artifacts.push({ path, url })
        }
      }

      return {
        exitCode: result.exitCode,
        stdout: limitOutput([setupStdout, result.stdout].filter(Boolean).join('\n')),
        stderr: limitOutput([setupStderr, result.stderr].filter(Boolean).join('\n')),
        binFiles,
        artifacts,
      }
    } finally {
      await machine.delete()
    }
  },
})

export const deleteArtifact = internalAction({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, { storageId }) => {
    await ctx.storage.delete(storageId)
    return null
  },
})
