'use node'

import { v } from 'convex/values'
import { Machine } from 'smolmachines'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { action, env, internalAction } from './_generated/server'
import { store } from './store'

const DEFAULT_SMOL_CLOUD_URL = 'https://api.smolmachines.com'
const MAX_OUTPUT_BYTES = 400 * 1024
const MAX_CACHED_LOG_BYTES = 200 * 1024
const PROS_KERNEL_URL =
  'https://pros.cs.purdue.edu/v5/_static/releases/kernel@3.8.3.zip'
const PROS_KERNEL_SHA256 =
  'fa0eddc8c9493ba1fca73ff7648227f8e84ec1784627f22e37a55445e5f2ecc8'
const PROS_KERNEL_ARCHIVE = '/tmp/pros-kernel-3.8.3.zip'
const PROS_KERNEL_IMAGE_DIR = '/opt/vex-build/pros-kernel-3.8.3'
const PROS_KERNEL_READY_MARKER =
  '/tmp/v5x-build-cache/pros-kernel-3.8.3.ready'
const EZ_TEMPLATE_PROJECT_URL =
  'https://github.com/EZ-Robotics/EZ-Template/releases/download/v3.2.2/EZ-Template-Example-Project.zip'
const EZ_TEMPLATE_PROJECT_SHA256 =
  '41ec47dc65588cf7efae84771965a4803611f5db88ed5465bbb829a5eb8d7822'
const EZ_TEMPLATE_PROJECT_ARCHIVE = '/tmp/ez-template-example-project-3.2.2.zip'
const EZ_TEMPLATE_IMAGE_DIR = '/opt/vex-build/ez-template-3.2.2'

const prepareProsBuild = [
  'set -eu',
  'command -v arm-none-eabi-gcc >/dev/null 2>&1 || { echo "PROS image is missing arm-none-eabi-gcc." >&2; exit 127; }',
  'command -v arm-none-eabi-g++ >/dev/null 2>&1 || { echo "PROS image is missing arm-none-eabi-g++." >&2; exit 127; }',
  'stdlib_path=$(arm-none-eabi-g++ -print-file-name=libstdc++.a)',
  '[ -f "$stdlib_path" ] || { echo "PROS image is missing the ARM C++ standard library." >&2; exit 127; }',
  `if [ -f '${PROS_KERNEL_READY_MARKER}' ] && [ -f '/workspace/common.mk' ] && [ -f '/workspace/firmware/libpros.a' ] && [ -f '/workspace/include/api.h' ]; then`,
  '  :',
  `elif [ -d '${PROS_KERNEL_IMAGE_DIR}' ]; then`,
  `  cp -a -n '${PROS_KERNEL_IMAGE_DIR}/.' '/workspace/'`,
  '  mkdir -p /tmp/v5x-build-cache',
  `  touch '${PROS_KERNEL_READY_MARKER}'`,
  'else',
  '  command -v wget >/dev/null 2>&1 || { echo "Build image is missing wget and the baked PROS kernel." >&2; exit 127; }',
  '  command -v unzip >/dev/null 2>&1 || { echo "Build image is missing unzip." >&2; exit 127; }',
  '  command -v sha256sum >/dev/null 2>&1 || { echo "Build image is missing sha256sum." >&2; exit 127; }',
  `  wget -q -O '${PROS_KERNEL_ARCHIVE}' '${PROS_KERNEL_URL}'`,
  `  printf '%s  %s\\n' '${PROS_KERNEL_SHA256}' '${PROS_KERNEL_ARCHIVE}' | sha256sum --check -`,
  `  unzip -n -q '${PROS_KERNEL_ARCHIVE}' -d '/workspace'`,
  '  mkdir -p /tmp/v5x-build-cache',
  `  touch '${PROS_KERNEL_READY_MARKER}'`,
  'fi',
].join('\n')

const prepareEzTemplateBuild = [
  'set -eu',
  'command -v arm-none-eabi-gcc >/dev/null 2>&1 || { echo "PROS image is missing arm-none-eabi-gcc." >&2; exit 127; }',
  'command -v arm-none-eabi-g++ >/dev/null 2>&1 || { echo "PROS image is missing arm-none-eabi-g++." >&2; exit 127; }',
  'stdlib_path=$(arm-none-eabi-g++ -print-file-name=libstdc++.a)',
  '[ -f "$stdlib_path" ] || { echo "PROS image is missing the ARM C++ standard library." >&2; exit 127; }',
  `if [ "$(cat '/workspace/.ez-template' 2>/dev/null || true)" = '3.2.2' ] && [ -f '/workspace/common.mk' ] && [ -f '/workspace/firmware/EZ-Template.a' ] && [ -f '/workspace/include/EZ-Template/api.hpp' ]; then`,
  '  :',
  `elif [ -d '${EZ_TEMPLATE_IMAGE_DIR}' ]; then`,
  `  cp -a -n '${EZ_TEMPLATE_IMAGE_DIR}/.' '/workspace/'`,
  'else',
  '  command -v wget >/dev/null 2>&1 || { echo "Build image is missing wget and the baked EZ Template files." >&2; exit 127; }',
  '  command -v unzip >/dev/null 2>&1 || { echo "Build image is missing unzip." >&2; exit 127; }',
  '  command -v sha256sum >/dev/null 2>&1 || { echo "Build image is missing sha256sum." >&2; exit 127; }',
  `  wget -q -O '${EZ_TEMPLATE_PROJECT_ARCHIVE}' '${EZ_TEMPLATE_PROJECT_URL}'`,
  `  printf '%s  %s\\n' '${EZ_TEMPLATE_PROJECT_SHA256}' '${EZ_TEMPLATE_PROJECT_ARCHIVE}' | sha256sum --check -`,
  `  unzip -n -q '${EZ_TEMPLATE_PROJECT_ARCHIVE}' 'common.mk' 'firmware/*' 'include/*' -d '/workspace'`,
  'fi',
].join('\n')

function limitOutput(output: string, maxBytes = MAX_OUTPUT_BYTES) {
  const bytes = new TextEncoder().encode(output)
  if (bytes.byteLength <= maxBytes) return output

  const tail = new TextDecoder().decode(bytes.slice(-maxBytes))
  return `[Output truncated; showing the last ${maxBytes} bytes]\n${tail}`
}

type BuildTiming = { stage: string; ms: number }
type BuildActionResult = {
  commitSha: string
  exitCode: number
  stdout: string
  stderr: string
  binFiles: string[]
  artifacts: Array<{ path: string; url: string }>
  timings: BuildTiming[]
}

function createBuildTimer(programId: string) {
  const timings: BuildTiming[] = []
  const measure = async <T>(
    stage: string,
    work: () => Promise<T>,
  ): Promise<T> => {
    const started = performance.now()
    try {
      return await work()
    } finally {
      const ms = Math.round(performance.now() - started)
      timings.push({ stage, ms })
      console.log(`[build ${programId}] ${stage}: ${ms} ms`)
    }
  }
  return { timings, measure }
}

type BuildMeasure = <T>(stage: string, work: () => Promise<T>) => Promise<T>

async function prepareBuildWorkspace(args: {
  machine: Machine
  remoteUrl: string
  commitSha: string
  previousCommitSha: string | null
  measure: BuildMeasure
}) {
  const { machine, remoteUrl, commitSha, previousCommitSha, measure } = args

  if (previousCommitSha !== null) {
    const credentials = await measure('Refresh repository credentials', () =>
      machine.exec(['git', 'remote', 'set-url', 'origin', remoteUrl], {
        workdir: '/workspace',
        timeout: 10,
      }),
    )
    if (credentials.exitCode !== 0) {
      throw new Error('Unable to refresh program repository credentials')
    }

    if (previousCommitSha !== commitSha) {
      const fetch = await measure('Fetch repository updates', () =>
        machine.exec(['git', 'fetch', '--no-tags', 'origin'], {
          workdir: '/workspace',
          timeout: 120,
        }),
      )
      if (fetch.exitCode !== 0) {
        throw new Error(
          `Unable to fetch program repository (${fetch.exitCode})`,
        )
      }
    }
  } else {
    const clone = await measure('Clone repository', () =>
      machine.exec(['git', 'clone', remoteUrl, '/workspace'], {
        timeout: 120,
      }),
    )
    if (clone.exitCode !== 0) {
      // Keep the short lived clone credential out of errors returned to clients.
      throw new Error(`Unable to clone program repository (${clone.exitCode})`)
    }
  }

  const checkout = await measure('Select program commit', () =>
    machine.exec(['git', 'checkout', '--force', '--detach', commitSha], {
      workdir: '/workspace',
      timeout: 30,
    }),
  )
  if (checkout.exitCode !== 0) {
    throw new Error(`Unable to select program commit (${checkout.exitCode})`)
  }

  const clearCredentials = await measure('Clear repository credentials', () =>
    machine.exec(
      [
        'git',
        'remote',
        'set-url',
        'origin',
        'https://invalid.invalid/v5x-build-cache',
      ],
      { workdir: '/workspace', timeout: 10 },
    ),
  )
  if (clearCredentials.exitCode !== 0) {
    throw new Error('Unable to clear program repository credentials')
  }
}

export const build = action({
  args: { programId: v.id('program') },
  returns: v.object({
    commitSha: v.string(),
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
    timings: v.array(v.object({ stage: v.string(), ms: v.number() })),
  }),
  handler: async (ctx, { programId }): Promise<BuildActionResult> => {
    const { timings, measure } = createBuildTimer(programId)
    const identity = await measure('Authenticate', () =>
      ctx.auth.getUserIdentity(),
    )
    if (!identity) throw new Error('Unauthorized')

    const program: Doc<'program'> | null = await measure('Load program', () =>
      ctx.runQuery(api.program.get, { programId }),
    )
    if (!program) throw new Error('Program not found')
    if (!program.currentCommitSha) {
      throw new Error('Program commit is still loading')
    }
    const commitSha: string = program.currentCommitSha

    const token = env.SMOL_CLOUD_TOKEN
    if (!token) throw new Error('SMOL_CLOUD_TOKEN is not configured')

    const cloudUrl = (env.SMOL_CLOUD_URL ?? DEFAULT_SMOL_CLOUD_URL).replace(
      /\/+$/,
      '',
    )
    const accountResponse = await measure('Resolve cloud account', () =>
      fetch(`${cloudUrl}/v1/me`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
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

    const imageTag = process.env.VEXCODE_IMAGE_TAG || 'v1'
    const machineImage = `registry.smolmachines.com/${registryNamespace}/vexcode:${imageTag}`
    const cloudConnection = {
      target: 'cloud' as const,
      apiKey: token,
      baseUrl: cloudUrl,
    }
    const warmBuild = await measure('Load warm build machine', () =>
      ctx.runQuery(internal.programBuildCache.getWarmMachine, {
        programId,
        imageTag,
      }),
    )
    const repo = store.repo({ id: program.repoId })
    const remoteUrl = await measure('Get repository URL', () =>
      repo.getRemoteURL({ permissions: ['git:read'], ttl: 900 }),
    )

    const startCleanMachine = () =>
      Machine.create(
        {
          image: machineImage,
          resources: { cpus: 2, memoryMb: 2048, network: true },
          ttlSeconds: 900,
          branchable: true,
        },
        cloudConnection,
      )

    let machine: Machine | null = null
    let sourceMachine: Machine | null = null
    if (warmBuild) {
      try {
        sourceMachine = await measure('Connect warm build machine', () =>
          Machine.connect(warmBuild.machineId, cloudConnection),
        )
        await measure('Branch warm build machine', async () => {
          await sourceMachine!.waitUntilReady({ timeoutMs: 15_000 })
          machine = await sourceMachine!.branch(
            `build-${crypto.randomUUID()}`,
            { branchable: true },
          )
        })
      } catch {
        console.warn(
          `[build ${programId}] Warm build machine unavailable; starting a clean machine`,
        )
        sourceMachine = null
      }
    }
    if (!machine) {
      machine = await measure('Start build machine', startCleanMachine)
    }
    if (!machine) throw new Error('Unable to start build machine')
    let buildMachine: Machine = machine
    let usingWarmBuild = Boolean(warmBuild && sourceMachine)

    const storedArtifacts: Array<{
      path: string
      storageId: Id<'_storage'>
      url: string
    }> = []
    let keepStoredArtifacts = false
    // Each follow-up build gets a CoW branch, keeping overlapping requests
    // from changing the saved incremental workspace.
    let keepWarmMachine = false
    let replacedMachineId: string | null = null

    try {
      try {
        await prepareBuildWorkspace({
          machine: buildMachine,
          remoteUrl,
          commitSha,
          previousCommitSha: usingWarmBuild ? warmBuild!.commitSha : null,
          measure,
        })
      } catch (error) {
        if (!usingWarmBuild) throw error

        console.warn(
          `[build ${programId}] Could not refresh warm workspace; retrying from a clean machine`,
        )
        await measure('Discard stale warm build branch', async () => {
          await buildMachine.delete().catch((deleteError: unknown) => {
            console.warn(
              `[build ${programId}] Could not discard stale build branch`,
              deleteError,
            )
          })
        })
        sourceMachine = null
        usingWarmBuild = false
        buildMachine = await measure(
          'Start clean fallback build machine',
          startCleanMachine,
        )
        machine = buildMachine
        await prepareBuildWorkspace({
          machine: buildMachine,
          remoteUrl,
          commitSha,
          previousCommitSha: null,
          measure,
        })
      }

      const claimed = await ctx.runMutation(internal.program.claimCommitBuild, {
        programId,
        commitSha,
      })
      if (!claimed) throw new Error('This commit has already been built')

      let setupStdout = ''
      let setupStderr = ''
      const prosProject = await measure('Detect PROS project', () =>
        buildMachine.exec(['test', '-f', 'project.pros'], {
          workdir: '/workspace',
          timeout: 10,
        }),
      )
      if (prosProject.exitCode === 0) {
        const ezTemplate = await measure('Detect EZ Template', () =>
          buildMachine.exec(['test', '-f', '.ez-template'], {
            workdir: '/workspace',
            timeout: 10,
          }),
        )
        const setupScript =
          ezTemplate.exitCode === 0 ? prepareEzTemplateBuild : prepareProsBuild
        const setup = await measure('Prepare SDK', () =>
          buildMachine.exec(['sh', '-lc', setupScript], {
            workdir: '/workspace',
            timeout: 240,
          }),
        )
        setupStdout = setup.stdout
        setupStderr = setup.stderr
        if (setup.exitCode !== 0) {
          const buildResult = {
            commitSha,
            exitCode: setup.exitCode,
            stdout: limitOutput(setup.stdout),
            stderr: limitOutput(setup.stderr),
            binFiles: [],
            artifacts: [],
            timings,
          }
          const cached = await ctx.runMutation(
            internal.programBuildCache.cacheLatest,
            {
              programId,
              commitSha,
              exitCode: buildResult.exitCode,
              stdout: limitOutput(buildResult.stdout, MAX_CACHED_LOG_BYTES),
              stderr: limitOutput(buildResult.stderr, MAX_CACHED_LOG_BYTES),
              artifacts: [],
              timings,
              warmMachineId: undefined,
              warmImageTag: undefined,
            },
          )
          if (cached) {
            keepStoredArtifacts = true
            replacedMachineId = cached.previousMachineId
          }
          return buildResult
        }
      }

      const result = await measure('Compile with make -j2', () =>
        buildMachine.exec(['make', '-j2'], {
          workdir: '/workspace',
          env: { VEX_SDK_PATH: '/sdk' },
          timeout: 300,
        }),
      )
      let binFiles: string[] = []
      if (result.exitCode === 0) {
        const binaries = await measure('Find build outputs', () =>
          buildMachine.exec(
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
          ),
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
          const file = await measure(`Read ${path}`, () =>
            buildMachine.readFile(`/workspace/${path}`),
          )
          const bytes = new Uint8Array(file.byteLength)
          bytes.set(file)
          const storageId = await measure(`Store ${path}`, () =>
            ctx.storage.store(
              new Blob([bytes.buffer], { type: 'application/octet-stream' }),
            ),
          )
          const url = await measure(`Sign ${path} URL`, () =>
            ctx.storage.getUrl(storageId),
          )
          if (url === null) {
            await ctx.storage.delete(storageId)
            throw new Error(`Unable to load build artifact ${path}`)
          }
          storedArtifacts.push({ path, storageId, url })
        }
      }

      const buildResult = {
        commitSha,
        exitCode: result.exitCode,
        stdout: limitOutput(
          [setupStdout, result.stdout].filter(Boolean).join('\n'),
        ),
        stderr: limitOutput(
          [setupStderr, result.stderr].filter(Boolean).join('\n'),
        ),
        binFiles,
        artifacts: storedArtifacts.map(({ path, url }) => ({ path, url })),
        timings,
      }
      const cached = await ctx.runMutation(
        internal.programBuildCache.cacheLatest,
        {
          programId,
          commitSha,
          exitCode: buildResult.exitCode,
          stdout: limitOutput(buildResult.stdout, MAX_CACHED_LOG_BYTES),
          stderr: limitOutput(buildResult.stderr, MAX_CACHED_LOG_BYTES),
          artifacts: storedArtifacts.map(({ path, storageId }) => ({
            path,
            storageId,
          })),
          timings,
          warmMachineId: buildMachine.id,
          warmImageTag: imageTag,
        },
      )
      if (cached) {
        keepStoredArtifacts = true
        keepWarmMachine = true
        replacedMachineId = cached.previousMachineId
      }

      return buildResult
    } finally {
      if (!keepStoredArtifacts) {
        await Promise.allSettled(
          storedArtifacts.map(({ storageId }) => ctx.storage.delete(storageId)),
        )
      }
      if (!keepWarmMachine) {
        await measure('Delete build machine', async () => {
          await buildMachine.delete().catch((error: unknown) => {
            console.warn(
              `[build ${programId}] Could not delete build machine`,
              error,
            )
          })
        })
      }
      const previousMachineId = replacedMachineId
      if (previousMachineId) {
        await measure('Delete previous warm build machine', async () => {
          try {
            const previousMachine =
              sourceMachine?.id === previousMachineId
                ? sourceMachine
                : await Machine.connect(previousMachineId, cloudConnection)
            await previousMachine.delete()
          } catch (error) {
            console.warn(
              `[build ${programId}] Could not delete previous warm build machine`,
              error,
            )
          }
        })
      }
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
