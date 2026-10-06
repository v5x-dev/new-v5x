import { v } from 'convex/values'
import { CloudBuildMachine } from './lib/cloudBuildMachine'
import { decodeBase64, sha256 as hashBytes } from './lib/buildBytes'
import { internal } from './_generated/api'
import { action, env, internalAction } from './_generated/server'
import { store } from './store'
import {
  BUILD_OUTPUTS_MARKER,
  collectBuildOutputs,
  parseBuildOutputs,
} from './lib/buildArtifacts'
import { fetchSourcePack, syncBuildWorkspace } from './lib/buildWorkspace'
import { prepareBuildSdk, preparePrecompiledHeader } from './lib/buildSdk'
import { prepareClangPch } from './lib/buildClangPch'

import {
  BUILD_GIT_ENV,
  DEFAULT_BUILD_IMAGE_TAG,
  DEFAULT_SMOL_CLOUD_URL,
  resolveBuildCloud,
} from './lib/buildCloudSettings'
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

const WORKSPACE_READY = '__V5X_WORKSPACE_READY__\n'

async function buildWorkspace(args: {
  machine: CloudBuildMachine
  remoteUrl: string
  commitSha: string
  previousCommitSha: string | null
  measure: BuildMeasure
  sourcePack: Awaited<ReturnType<typeof fetchSourcePack>> | null
}) {
  const {
    machine,
    remoteUrl,
    commitSha,
    previousCommitSha,
    measure,
    sourcePack,
  } = args
  const result = await measure('Sync and compile with make -j8', () =>
    machine.exec(
      [
        'sh',
        '-c',
        [
          syncBuildWorkspace,
          'clear_credentials',
          `printf '${WORKSPACE_READY}'`,
          'cd /workspace',
          prepareBuildSdk,
          // A changed build configuration invalidates both hot and cold objects.
          // Header removals also invalidate the PCH, even though find -newer cannot
          // observe a file that no longer exists.
          'if [ -n "$previous_sha" ]; then',
          '  changed_headers="$(git diff --name-only "$previous_sha" "$commit_sha" | grep -E \'\\.(h|hh|hpp|hxx|inc)$\' || true)"',
          '  if [ -n "$changed_headers" ]; then',
          "    find ./build ./bin -type f \\( -name '*.o' -o -name '*.pch' \\) -delete 2>/dev/null || true",
          '    rm -f include/main.h.gch',
          '  fi',
          '  if ! git diff --quiet "$previous_sha" "$commit_sha" -- makefile Makefile common.mk vex firmware project.pros .ez-template; then',
          "    find ./build ./bin -type f \\( -name '*.o' -o -name '*.elf' -o -name '*.bin' -o -name '*.pch' \\) -delete 2>/dev/null || true",
          '    rm -f include/main.h.gch',
          '  fi',
          'fi',
          'reuse=0',
          'if [ -n "$previous_sha" ] && git diff --quiet "$previous_sha" "$commit_sha"; then',
          '  existing_bin="$(find ./build ./bin -type f -name \'*.bin\' -print -quit 2>/dev/null || true)"',
          '  if [ -n "$existing_bin" ]; then reuse=1; fi',
          'fi',
          'if [ "$reuse" -eq 1 ]; then',
          '  echo "Reusing prebuilt template binaries"',
          'else',
          // Preserve cold packages until make detects a library/configuration change.
          // Always relink after edits, including source deletions.
          "  find ./build ./bin -type f \\( -name '*.bin' -o -name '*.elf' \\) ! -name 'cold.package.bin' ! -name 'cold.package.elf' -delete 2>/dev/null || true",
          preparePrecompiledHeader,
          prepareClangPch,
          '  make -j8 P=workspace $build_makefile_args',
          'fi',
          collectBuildOutputs,
        ].join('\n'),
        'build-workspace',
        // The fast transport never passes repository credentials to the guest.
        sourcePack ? '-' : remoteUrl,
        commitSha,
        previousCommitSha ?? '-',
        sourcePack ? 'pack' : '-',
        sourcePack?.shallow || '-',
        ...(sourcePack?.chunks ?? []),
      ],
      { timeout: 300, env: { ...BUILD_GIT_ENV, VEX_SDK_PATH: '/sdk' } },
    ),
  )
  const ready = result.stdout.indexOf(WORKSPACE_READY)
  if (ready < 0)
    throw new Error(`Unable to sync program repository (${result.exitCode})`)
  return {
    ...result,
    stdout: result.stdout.slice(ready + WORKSPACE_READY.length),
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

      const sourcePackPromise = measure('Fetch source pack', () =>
        fetchSourcePack(
          remoteUrl,
          commitSha,
          warmBuild?.artifacts.length ? warmBuild.commitSha : undefined,
        ),
      ).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : ''
        console.warn(
          /^Source pack |^Invalid Git |^Incomplete Git |^Unexpected Git |^Missing Git /.test(
            message,
          )
            ? message
            : 'Source pack transport failed',
        )
        return null
      })

      let machineExpiresAt = warmBuild?.expiresAt ?? 0

      const startCleanMachine = async () => {
        machineExpiresAt = Date.now() + 840_000
        const namespace = await resolveBuildCloud(token, cloudUrl)
        return CloudBuildMachine.create(
          `registry.smolmachines.com/${namespace}/vexcode:${imageTag}`,
          cloudConnection,
        )
      }

      let machine: CloudBuildMachine | null = null
      let usingWarmBuild = false

      if (warmBuild) {
        try {
          machine = await measure('Resume warm build machine', async () => {
            // Ownership is transferred atomically from a ready worker. The build
            // exec itself validates availability; stale workers take the fallback.
            const warm = new CloudBuildMachine(
              warmBuild.machineId,
              cloudConnection,
            )
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

      let buildMachine: CloudBuildMachine = machine

      const storedArtifacts: Array<{
        path: string
        storageId: Id<'_storage'>
        url: string
        sha256: string
      }> = []

      const ownedStorageIds = new Set<Id<'_storage'>>()
      let keepStoredArtifacts = false
      // takeWarmMachine atomically transfers ownership to this request.
      // Overlapping builds get a separate machine.
      let keepWarmMachine = false
      let replacedMachineId: string | null = null

      try {
        let result: Awaited<ReturnType<CloudBuildMachine['exec']>>
        try {
          result = await buildWorkspace({
            machine: buildMachine,
            remoteUrl,
            commitSha,
            previousCommitSha: usingWarmBuild ? warmBuild!.commitSha : null,
            measure,
            sourcePack: await sourcePackPromise,
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

          result = await buildWorkspace({
            machine: buildMachine,
            remoteUrl,
            commitSha,
            previousCommitSha: null,
            measure,
            sourcePack: await sourcePackPromise,
          })
        }

        const outputsMarker = BUILD_OUTPUTS_MARKER
        const manifest =
          result.exitCode === 0 ? parseBuildOutputs(result.stdout) : null
        const outputsStart = result.stdout.lastIndexOf(outputsMarker)
        const buildStdout =
          manifest?.stdout ??
          (outputsStart < 0
            ? result.stdout
            : result.stdout.slice(0, outputsStart))
        const binFiles = manifest?.outputs.map(({ path }) => path) ?? []

        if (manifest) {
          const uploads = await Promise.allSettled(
            manifest.outputs.map(async ({ path, sha256, size, base64 }) => {
              const previous = warmBuild?.artifacts.find(
                (artifact) => artifact.sha256 === sha256,
              )
              let storageId = previous?.storageId
              if (!storageId) {
                const file =
                  base64 || size === 0
                    ? decodeBase64(base64)
                    : await measure(`Read ${path}`, () =>
                        buildMachine.readFile(`/workspace/${path}`),
                      )
                if (
                  file.byteLength !== size ||
                  (await hashBytes(file)) !== sha256
                ) {
                  throw new Error(
                    `Build artifact failed integrity check: ${path}`,
                  )
                }
                const bytes = new Uint8Array(file.byteLength)
                bytes.set(file)
                storageId = await measure(`Store ${path}`, () =>
                  ctx.storage.store(
                    new Blob([bytes.buffer], {
                      type: 'application/octet-stream',
                    }),
                  ),
                )
                ownedStorageIds.add(storageId)
              } else {
                timings.push({ stage: `Reuse ${path}`, ms: 0 })
              }

              const url = await measure(`Sign ${path} URL`, () =>
                ctx.storage.getUrl(storageId),
              )

              if (url === null) {
                throw new Error(`Unable to load build artifact ${path}`)
              }

              storedArtifacts.push({
                path,
                storageId,
                url,
                sha256,
              })
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
            artifacts: storedArtifacts.map(({ path, storageId, sha256 }) => ({
              path,
              storageId,
              sha256,
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
            [...ownedStorageIds].map((storageId) =>
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
    const machine = new CloudBuildMachine(machineId, {
      apiKey: env.SMOL_CLOUD_TOKEN ?? '',
      baseUrl: (env.SMOL_CLOUD_URL ?? DEFAULT_SMOL_CLOUD_URL).replace(
        /\/+$/,
        '',
      ),
    })
    await machine.delete()
  },
})
