'use node'

import { v } from 'convex/values'
import { Machine } from 'smolmachines'
import { internal } from './_generated/api'
import { action, env, internalAction } from './_generated/server'
import { store } from './store'
import { prepareBuildSdk, preparePrecompiledHeader } from './lib/buildSdk'

import {
  BUILD_GIT_ENV,
  DEFAULT_BUILD_IMAGE_TAG,
  DEFAULT_SMOL_CLOUD_URL,
  createBuildMachine,
  resolveBuildCloud,
} from './lib/buildCloud'
import type { Id } from './_generated/dataModel'

const MAX_OUTPUT_BYTES = 400 * 1024

const MAX_CACHED_LOG_BYTES = 200 * 1024

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
  binFiles: Array<string>
  artifacts: Array<{ path: string; url: string }>
  timings: Array<BuildTiming>
}

function createBuildTimer(programId: string) {
  const timings: Array<BuildTiming> = []

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

  // Pass credentials as an argument, never interpolate them into shell source.
  // A trap clears them on checkout/fetch failures as well as on success.
  const result = await measure('Sync program workspace', () =>
    machine.exec(
      [
        'sh',
        '-c',
        [
          'set -eu',
          'remote_url="$1"',
          'commit_sha="$2"',
          'previous_sha="$3"',
          'clear_credentials() { git -C /workspace remote set-url origin https://invalid.invalid/v5x-build-cache 2>/dev/null || true; }',
          'trap clear_credentials EXIT',
          'if [ -n "$previous_sha" ]; then',
          '  git -C /workspace remote set-url origin "$remote_url"',
          '  if [ "$previous_sha" != "$commit_sha" ]; then',
          '    git -C /workspace fetch --no-tags --depth=1 origin "$commit_sha"',
          '  fi',
          'else',
          '  git clone --no-checkout --depth=1 "$remote_url" /workspace',
          '  git -C /workspace cat-file -e "$commit_sha^{commit}" 2>/dev/null || git -C /workspace fetch --no-tags --depth=1 origin "$commit_sha"',
          'fi',
          'git -C /workspace checkout --force --detach "$commit_sha"',
        ].join('\n'),
        'sync-workspace',
        remoteUrl,
        commitSha,
        previousCommitSha ?? '',
      ],
      { timeout: 120, env: BUILD_GIT_ENV },
    ),
  )

  if (result.exitCode !== 0) {
    // Git errors can contain the short-lived credential.
    throw new Error(`Unable to sync program repository (${result.exitCode})`)
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

    const token = env.SMOL_CLOUD_TOKEN
    if (!token) throw new Error('SMOL_CLOUD_TOKEN is not configured')

    const cloudUrl = (env.SMOL_CLOUD_URL ?? DEFAULT_SMOL_CLOUD_URL).replace(
      /\/+$/,
      '',
    )

    const imageTag = env.VEXCODE_IMAGE_TAG ?? DEFAULT_BUILD_IMAGE_TAG

    const cloudConnection = {
      target: 'cloud' as const,
      apiKey: token,
      baseUrl: cloudUrl,
    }

    const { program, commitSha, warmBuild } = await measure(
      'Acquire build workspace',
      () =>
        ctx.runMutation(internal.buildRequest.acquire, {
          programId,
          ownerId: identity.subject,
          imageTag,
        }),
    )

    try {
      const repo = store.repo({ id: program.repoId })
      let remoteUrl: string
      try {
        remoteUrl = await measure('Get repository URL', () =>
          repo.getRemoteURL({ permissions: ['git:read'], ttl: 900 }),
        )
      } catch (error) {
        if (warmBuild)
          await ctx.scheduler.runAfter(0, internal.programBuild.deleteMachine, {
            machineId: warmBuild.machineId,
          })
        throw error
      }

      let machineExpiresAt = warmBuild?.expiresAt ?? 0

      const startCleanMachine = async () => {
        machineExpiresAt = Date.now() + 840_000
        const namespace = await resolveBuildCloud(token, cloudUrl)
        return createBuildMachine(namespace, imageTag, token, cloudUrl)
      }

      let machine: Machine | null = null
      let usingWarmBuild = false

      if (warmBuild) {
        try {
          machine = await measure('Resume warm build machine', async () => {
            const warm = await Machine.connect(
              warmBuild.machineId,
              cloudConnection,
            )
            await warm.waitUntilReady({ timeoutMs: 15_000 })
            return warm
          })
          usingWarmBuild = true
        } catch {
          console.warn(
            `[build ${programId}] Warm build machine unavailable; starting a clean machine`,
          )

          machine = null
        }
      }

      if (!machine) {
        machine = await measure('Start build machine', startCleanMachine)
      }

      let buildMachine: Machine = machine

      const storedArtifacts: Array<{
        path: string
        storageId: Id<'_storage'>
        url: string
      }> = []

      let keepStoredArtifacts = false
      // takeWarmMachine atomically transfers ownership to this request.
      // Overlapping builds get a separate machine.
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

          machine = null
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

        const outputsMarker = '\n__V5X_BUILD_OUTPUTS__\n'
        const result = await measure(
          'Prepare SDK and compile with make -j8',
          () =>
            buildMachine.exec(
              [
                'sh',
                '-c',
                [
                  prepareBuildSdk,
                  'previous_sha="$1"',
                  'commit_sha="$2"',
                  // A fresh template matches the worker that already compiled it.
                  // Keep those binaries. Any content change still relinks, including
                  // when sources were deleted, while object files stay for make.
                  'reuse=0',
                  'if [ -n "$previous_sha" ] && git diff --quiet "$previous_sha" "$commit_sha"; then',
                  '  existing_bin="$(find ./build ./bin -type f -name \'*.bin\' -print -quit 2>/dev/null || true)"',
                  '  if [ -n "$existing_bin" ]; then reuse=1; fi',
                  'fi',
                  'if [ "$reuse" -eq 1 ]; then',
                  '  echo "Reusing prebuilt template binaries"',
                  'else',
                  "  find ./build ./bin -type f \\( -name '*.bin' -o -name '*.elf' \\) ! -name 'cold.package.bin' ! -name 'cold.package.elf' -delete 2>/dev/null || true",
                  preparePrecompiledHeader,
                  '  make -j8 P=workspace',
                  'fi',
                  "printf '\\n__V5X_BUILD_OUTPUTS__\\n'",
                  "find ./build ./bin -type f -name '*.bin' 2>/dev/null || true",
                ].join('\n'),
                'build-workspace',
                usingWarmBuild ? warmBuild!.commitSha : '',
                commitSha,
              ],
              {
                workdir: '/workspace',
                env: { ...BUILD_GIT_ENV, VEX_SDK_PATH: '/sdk' },
                timeout: 300,
              },
            ),
        )
        const outputsStart = result.stdout.lastIndexOf(outputsMarker)
        const buildStdout =
          outputsStart < 0
            ? result.stdout
            : result.stdout.slice(0, outputsStart)
        let binFiles: Array<string> = []

        if (result.exitCode === 0) {
          if (outputsStart >= 0) {
            binFiles = result.stdout
              .slice(outputsStart + outputsMarker.length)
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

          const uploads = await Promise.allSettled(
            binFiles.map(async (path) => {
              const file = await measure(`Read ${path}`, () =>
                buildMachine.readFile(`/workspace/${path}`),
              )

              const bytes = new Uint8Array(file.byteLength)
              bytes.set(file)

              const storageId = await measure(`Store ${path}`, () =>
                ctx.storage.store(
                  new Blob([bytes.buffer], {
                    type: 'application/octet-stream',
                  }),
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
            }),
          )
          const failedUpload = uploads.find(
            (upload) => upload.status === 'rejected',
          )
          if (failedUpload?.status === 'rejected') throw failedUpload.reason
          storedArtifacts.sort((a, b) => a.path.localeCompare(b.path))
        }

        const buildResult = {
          commitSha,
          exitCode: result.exitCode,
          stdout: limitOutput(buildStdout),
          stderr: limitOutput(result.stderr),
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
            warmExpiresAt: machineExpiresAt,
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
            storedArtifacts.map(({ storageId }) =>
              ctx.storage.delete(storageId),
            ),
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
          await ctx.scheduler.runAfter(0, internal.programBuild.deleteMachine, {
            machineId: previousMachineId,
          })
        }
      }
    } catch (error) {
      await ctx.runMutation(internal.buildRequest.release, {
        programId,
        commitSha,
      })
      throw error
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

export const deleteMachine = internalAction({
  args: { machineId: v.string() },
  handler: async (_ctx, { machineId }) => {
    const machine = await Machine.connect(machineId, {
      target: 'cloud',
      apiKey: env.SMOL_CLOUD_TOKEN,
      baseUrl: env.SMOL_CLOUD_URL ?? DEFAULT_SMOL_CLOUD_URL,
    })
    await machine.delete()
  },
})
