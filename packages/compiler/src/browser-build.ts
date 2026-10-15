import { BrowserBuildSession, validDependencyRecord } from './build-session'
import { buildTimings } from './build-performance'
import { buildCacheKey } from './build-cache'
import { compileBrowserSources } from './browser-compile'
import { linkBrowserProgram } from './browser-link'
import { plannedCompilerCommand } from './compiler-plan'
import type { CompilerPlan } from './compiler-plan'
import type { PrebuiltColdSdk, StarterObject } from './build-assets'
import type { BuildTimingEvent } from './build-performance'
import type { BuildCache } from './build-cache'
import type { Session } from 'microbit-clang-wasm'
import type { ProjectTemplate } from './compile-commands'

export interface BrowserBuildInput {
  workspaceId?: string
  buildId?: string
  trace?: boolean
  kind?: 'preload'
  knownArtifacts?: Array<string>
  experiments?: {
    parallel?: 1 | 2
    optimization?: 'O0' | 'O1' | 'Os'
    pch?: 'off' | 'project'
    metadata?: 'compile'
    freshSession?: boolean
    cache?: boolean
    prebuiltCold?: boolean
    starter?: boolean
    driver?: boolean
  }
  files: Record<string, string>
  template: ProjectTemplate
  commitSha: string
}

export interface BrowserBuildResult {
  commitSha: string
  exitCode: number
  output: string
  artifacts: Array<{ path: string; bytes: Uint8Array }>
}

import {
  browserCompileCommands,
  browserPchArguments,
  splitBuildFlags,
} from './browser-commands'

export { browserCompileCommands, browserPchArguments, splitBuildFlags }

export async function compileBrowserProject(
  session: Session,
  input: BrowserBuildInput,
  gccVersion: string,
  report: (text: string) => void,
  caching?: {
    cache: BuildCache
    sdkKey: string
    state?: BrowserBuildSession
    parallelCompiler?: {
      compile: (
        argv: Array<string>,
        object: string,
      ) => Promise<{
        code: number
        output: string
        bytes: Uint8Array | null
        dependencies: Uint8Array | null
      }>
    }
    starterObjects?: {
      entries: Array<StarterObject>
      load: (asset: StarterObject['asset']) => Promise<Uint8Array>
    }
    metadataObject?: Uint8Array
    compilerPlans?: Array<CompilerPlan>
    prebuiltCold?: {
      metadata: PrebuiltColdSdk
      symbols: Uint8Array
      binary: Uint8Array
    }
    timing?: (event: BuildTimingEvent) => void
  },
): Promise<BrowserBuildResult> {
  const timing = buildTimings(input.buildId ?? 'local', caching?.timing)
  const state = caching?.state ?? new BrowserBuildSession(session)
  const buildStart = performance.now()
  const counts = {
    sources: 0,
    objectsReused: 0,
    starterObjectsReused: 0,
    commands: 0,
    projectWrites: 0,
    projectDeletes: 0,
    returnedBytes: 0,
  }
  let output = ''
  const emit = (text: string) => {
    output = (output + text).slice(-400 * 1024)
    report(text)
  }
  const decoder = new TextDecoder()
  const stream = (bytes: Uint8Array | null) => {
    const text = bytes
      ? decoder.decode(bytes, { stream: true })
      : decoder.decode()
    if (text) emit(text)
  }
  const run = async (argv: Array<string>) => {
    counts.commands++
    emit(`${argv.join(' ')}\n`)
    return timing.measure(
      argv[0] === 'clang'
        ? argv.includes('/workspace/.browser-build/timestamp.c')
          ? 'timestamp-compile'
          : 'compile'
        : argv.includes('--no-gc-sections')
          ? 'cold-link'
          : 'user-link',
      () => {
        const source =
          argv[0] === 'clang'
            ? commands.find((command) => argv.includes(command.file))
            : undefined
        const planned =
          caching?.compilerPlans &&
          input.experiments?.driver !== false &&
          source
            ? plannedCompilerCommand(
                caching.compilerPlans,
                argv,
                source.file,
                source.object,
              )
            : undefined
        return planned
          ? session.exec(planned, { stdout: stream, stderr: stream })
          : session.run(argv, { stdout: stream, stderr: stream })
      },
    )
  }
  const result = (
    exitCode: number,
    artifacts: BrowserBuildResult['artifacts'] = [],
  ) => {
    counts.returnedBytes = artifacts.reduce(
      (sum, artifact) => sum + artifact.bytes.byteLength,
      0,
    )
    caching?.timing?.({
      buildId: input.buildId ?? 'local',
      clock: 'worker',
      phase: 'compiler-total',
      start: buildStart,
      end: performance.now(),
      outcome: exitCode ? 'error' : 'success',
      counts,
    })
    return {
      commitSha: input.commitSha,
      exitCode,
      output,
      artifacts,
    }
  }

  const synchronization = await timing.measure('project-synchronization', () =>
    state.synchronize(input.files),
  )
  counts.projectWrites = synchronization.written
  counts.projectDeletes = synchronization.removed
  const commands = browserCompileCommands(input, gccVersion)
  counts.sources = commands.length
  // Imported driver commands and response files may read inputs absent from depfiles.
  const cacheSafeConfiguration =
    !input.files['compile_commands.json'] &&
    !commands.some((command) =>
      command.argv.some(
        (arg) =>
          arg.startsWith('@') ||
          /(?:module|plugin|profile|vfsoverlay|vfs-overlay)/.test(arg) ||
          arg === '-Xclang' ||
          arg === '-load',
      ),
    )
  const namespace = caching
    ? await buildCacheKey([
        'clang-21.11.0-browser-build-v4',
        caching.sdkKey,
        JSON.stringify(state.inventory(input.files)),
      ])
    : ''
  const dependencyKey = (paths: Array<string>) => state.dependencyKey(paths)
  const finalDependencies = new Set<string>()
  const finalEligibility = { value: true }
  const vex = input.template === 'vexcode' || input.template === 'jar-template'
  const finalKey =
    caching && vex && cacheSafeConfiguration
      ? await buildCacheKey([
          'browser-final-v1',
          caching.sdkKey,
          gccVersion,
          JSON.stringify(commands.map((command) => command.argv)),
          JSON.stringify(
            Object.entries(input.files).sort(([a], [b]) => a.localeCompare(b)),
          ),
        ])
      : undefined
  if (finalKey && caching) {
    const stored = await caching.cache.get(finalKey)
    if (stored) {
      try {
        const metadata: unknown = JSON.parse(new TextDecoder().decode(stored))
        if (
          validDependencyRecord(metadata) &&
          (await dependencyKey(metadata.paths)) === metadata.digest
        ) {
          const bytes = await caching.cache.get(
            await buildCacheKey([finalKey, metadata.digest, 'binary']),
          )
          if (bytes) {
            emit(
              `Reused completed browser build (${bytes.byteLength} bytes in this browser).\n`,
            )
            return result(0, [{ path: 'build/workspace.bin', bytes }])
          }
        }
      } catch {
        /* Missing/corrupt final entries compile normally. */
      }
    }
  }
  const failed = await compileBrowserSources({
    session,
    input,
    gccVersion,
    vex,
    commands,
    caching,
    cacheSafeConfiguration,
    namespace,
    state,
    timing,
    emit,
    stream,
    run,
    counts,
    finalDependencies,
    finalEligibility,
    dependencyKey,
  })
  if (failed) return result(failed)

  return linkBrowserProgram({
    session,
    input,
    gccVersion,
    vex,
    commands,
    run,
    result,
    state,
    timing,
    caching,
    emit,
    finalKey,
    finalEligibility,
    finalDependencies,
    dependencyKey,
  })
}
