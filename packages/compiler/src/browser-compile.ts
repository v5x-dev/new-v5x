import { includeInventory, validDependencyRecord } from './build-session'
import type { BrowserBuildSession } from './build-session'
import type { buildTimings } from './build-performance'
import { buildCacheKey, dependencyPaths } from './build-cache'
import { matchesSdkPchPrefix } from './sdk-pch'
import { browserPchArguments } from './browser-commands'
import type { BrowserBuildInput } from './browser-build'
import type { StarterObject } from './build-assets'
import type { BuildCache } from './build-cache'
import type { Session } from 'microbit-clang-wasm'

interface CompileCounts {
  sources: number
  objectsReused: number
  starterObjectsReused: number
  commands: number
  projectWrites: number
  projectDeletes: number
  returnedBytes: number
}

interface CompileContext {
  session: Session
  input: BrowserBuildInput
  gccVersion: string
  vex: boolean
  commands: Array<{ file: string; argv: Array<string>; object: string }>
  caching?: {
    cache: BuildCache
    sdkKey: string
    starterObjects?: {
      entries: Array<StarterObject>
      load: (asset: StarterObject['asset']) => Promise<Uint8Array>
    }
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
  }
  cacheSafeConfiguration: boolean
  namespace: string
  state: BrowserBuildSession
  timing: ReturnType<typeof buildTimings>
  emit: (text: string) => void
  stream: (bytes: Uint8Array | null) => void
  run: (argv: Array<string>) => Promise<number>
  counts: CompileCounts
  finalDependencies: Set<string>
  finalEligibility: { value: boolean }
  dependencyKey: (paths: Array<string>) => Promise<string | undefined>
}

export async function compileBrowserSources(ctx: CompileContext) {
  const {
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
  } = ctx

  let compilationAssignment = 0
  const compile = async (argv: Array<string>, object: string) => {
    const enabled =
      Boolean(caching) &&
      cacheSafeConfiguration &&
      !argv.some((arg) => /__DATE__|__TIME__|__TIMESTAMP__/.test(arg))
    if (!enabled) finalEligibility.value = false
    const key = enabled
      ? await buildCacheKey([namespace, JSON.stringify(argv)])
      : ''
    if (enabled && caching) {
      const manifest = await caching.cache.get(key)
      if (manifest) {
        try {
          const record: unknown = JSON.parse(new TextDecoder().decode(manifest))
          if (!validDependencyRecord(record))
            throw new Error('Invalid dependencies')
          const { paths, digest } = record
          paths.forEach((path) => finalDependencies.add(path))
          if (
            paths.length &&
            (await timing.measure('dependency-validation', () =>
              dependencyKey(paths),
            )) === digest
          ) {
            const bytes = await caching.cache.get(
              await buildCacheKey([key, digest]),
            )
            if (bytes) {
              counts.objectsReused++
              await state.writeFile(object, bytes)
              emit(
                `Reused ${object.slice('/workspace/.browser-build/'.length)}.\n`,
              )
              return 0
            }
          }
        } catch {
          /* A missing or corrupt cache entry is rebuilt. */
        }
      }
    }
    if (
      enabled &&
      caching?.starterObjects &&
      input.experiments?.starter !== false
    ) {
      const ordinary = argv.filter(
        (arg, index) =>
          arg !== '-include-pch' && argv[index - 1] !== '-include-pch',
      )
      const candidate = caching.starterObjects.entries.find(
        (entry) =>
          entry.version === 1 &&
          entry.gccVersion === gccVersion &&
          JSON.stringify(entry.arguments) === JSON.stringify(ordinary) &&
          JSON.stringify(entry.inventory) ===
            JSON.stringify(state.inventory(input.files)),
      )
      if (
        candidate &&
        validDependencyRecord(candidate) &&
        (await state.dependencyDigest(
          ordinary.find((arg) => arg.startsWith('/workspace/src/'))!,
        )) === candidate.sourceDigest &&
        (await dependencyKey(candidate.paths)) === candidate.digest
      ) {
        try {
          const bytes = await caching.starterObjects.load(candidate.asset)
          await state.writeFile(object, bytes)
          candidate.paths.forEach((path) => finalDependencies.add(path))
          counts.objectsReused++
          counts.starterObjectsReused++
          emit(
            `Reused verified starter ${object.slice('/workspace/.browser-build/'.length)}.\n`,
          )
          await caching.cache.put(
            await buildCacheKey([key, candidate.digest]),
            bytes,
          )
          await caching.cache.put(
            key,
            new TextEncoder().encode(
              JSON.stringify({
                paths: candidate.paths,
                digest: candidate.digest,
              }),
            ),
          )
          return 0
        } catch {
          /* Optional starter downloads never prevent local compilation. */
        }
      }
    }
    const depfile = object + '.d'
    const effectiveArgv = enabled ? [...argv, '-MD', '-MF', depfile] : argv
    let code: number
    if (
      caching?.parallelCompiler &&
      enabled &&
      compilationAssignment++ % 2 === 1
    ) {
      try {
        const remote = await timing.measure('parallel-source-compile', () =>
          caching.parallelCompiler!.compile(effectiveArgv, object),
        )
        counts.commands++
        emit(
          `[Parallel source ${object.slice('/workspace/.browser-build/'.length)}]\n${remote.output}`,
        )
        code = remote.code
        if (!code && remote.bytes) {
          await state.writeFile(object, remote.bytes)
          if (remote.dependencies)
            await state.writeFile(depfile, remote.dependencies)
        }
      } catch {
        emit('Parallel compiler unavailable; compiling source locally.\n')
        code = await run(effectiveArgv)
      }
    } else code = await run(effectiveArgv)
    if (!code && enabled && caching) {
      const dependencies = await session.readFile(depfile)
      const bytes = await session.readFile(object)
      const paths = dependencies
        ? dependencyPaths(new TextDecoder().decode(dependencies))
        : []
      paths.forEach((path) => finalDependencies.add(path))
      const digest = paths.length ? await dependencyKey(paths) : undefined
      if (!digest) finalEligibility.value = false
      if (bytes && digest) {
        await caching.cache.put(await buildCacheKey([key, digest]), bytes)
        await caching.cache.put(
          key,
          new TextEncoder().encode(JSON.stringify({ paths, digest })),
        )
      }
    }
    return code
  }
  // Only use a PCH when main.h is the first directive. Source-defined macros
  // and sources that do not include main.h retain their normal preprocessing.
  const umbrella = vex ? 'vex.h' : 'main.h'
  const firstUmbrellaDirective = new RegExp(
    '^\\s*(?:(?:\\/\\/[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/)\\s*)*#\\s*include\\s*"' +
      umbrella.replace('.', '\\.') +
      '"',
  )
  const pchCommands =
    cacheSafeConfiguration &&
    input.experiments?.pch !== 'off' &&
    input.experiments?.parallel !== 2 &&
    input.files[`include/${umbrella}`]
      ? commands.filter(
          (command) =>
            command.file.endsWith('.cpp') &&
            firstUmbrellaDirective.test(
              input.files[command.file.slice('/workspace/'.length)] ?? '',
            ),
        )
      : []
  const groups = new Map<string, Array<(typeof commands)[number]>>()
  for (const command of pchCommands) {
    const key = JSON.stringify(browserPchArguments(command))
    groups.set(key, [...(groups.get(key) ?? []), command])
  }
  const pchBySource = new Map<string, string>()
  const precompiled =
    input.experiments?.pch === 'off'
      ? null
      : await session.readFile('/sdk/ez/main-pch.json')
  if (precompiled) {
    try {
      const metadata = JSON.parse(new TextDecoder().decode(precompiled)) as {
        version?: number
        arguments: Array<string>
        paths: Array<string>
        digest: string
        workspacePaths: Array<string>
        prefix?: unknown
      }
      for (const [args, group] of groups) {
        if (
          args !== JSON.stringify(metadata.arguments) ||
          JSON.stringify(state.inventory(input.files)) !==
            JSON.stringify(
              includeInventory(
                metadata.workspacePaths,
                state.inventory(input.files).length ===
                  Object.keys(input.files).length,
              ),
            )
        )
          continue
        if (!validDependencyRecord(metadata)) continue
        if (metadata.version === 4) {
          if (!matchesSdkPchPrefix(input.files, metadata.prefix)) continue
          await state.synchronizeSdkPrefix(metadata.prefix.header)
          if ((await dependencyKey(metadata.paths)) !== metadata.digest)
            continue
          for (const command of group)
            pchBySource.set(command.file, '/sdk/ez/main.pch')
          continue
        }
        if (metadata.version === 3) {
          if ((await dependencyKey(metadata.paths)) !== metadata.digest)
            continue
          for (const command of group)
            pchBySource.set(command.file, '/sdk/ez/main.pch')
          continue
        }
        const parts: Array<string | Uint8Array> = []
        let valid = true
        for (const path of metadata.paths) {
          const bytes = await session.readFile(path)
          if (
            !bytes ||
            /__DATE__|__TIME__|__TIMESTAMP__/.test(
              new TextDecoder().decode(bytes),
            )
          ) {
            valid = false
            break
          }
          parts.push(path, bytes)
        }
        if (!valid || (await buildCacheKey(parts)) !== metadata.digest) continue
        for (const command of group)
          pchBySource.set(command.file, '/sdk/ez/main.pch')
      }
      if (pchBySource.size) emit('Using checked SDK precompiled headers.\n')
    } catch {
      pchBySource.clear()
    }
  }
  if (
    input.experiments?.pch === 'project' &&
    input.experiments.parallel !== 2
  ) {
    for (const [args, group] of groups) {
      if (
        group.length < 2 ||
        group.every((command) => pchBySource.has(command.file))
      )
        continue
      const inventory = JSON.stringify(state.inventory(input.files))
      const retained = state.projectPch
      if (
        retained &&
        retained.args === args &&
        retained.inventory === inventory &&
        (await dependencyKey(retained.paths)) === retained.digest
      ) {
        group.forEach((command) => pchBySource.set(command.file, retained.path))
        continue
      }
      await session.remove('/workspace/.browser-pch')
      state.projectPch = undefined
      const header = `/workspace/include/${umbrella}`
      const path = '/workspace/.browser-pch/main.pch'
      const depfile = path + '.d'
      const code = await timing.measure('project-pch-generation', () =>
        session.run(
          [
            ...JSON.parse(args),
            '-x',
            'c++-header',
            header,
            '-o',
            path,
            '-MD',
            '-MF',
            depfile,
          ],
          { stdout: stream, stderr: stream },
        ),
      )
      counts.commands++
      if (code) continue
      const dependencies = await session.readFile(depfile)
      const paths = dependencies
        ? dependencyPaths(new TextDecoder().decode(dependencies))
        : []
      const digest = paths.length ? await dependencyKey(paths) : undefined
      if (!digest) {
        await session.remove('/workspace/.browser-pch')
        continue
      }
      state.projectPch = { args, inventory, paths, digest, path }
      group.forEach((command) => pchBySource.set(command.file, path))
      break // Retain at most one project PCH configuration.
    }
  }
  const compileCommand = async (command: (typeof commands)[number]) => {
    const pch = pchBySource.get(command.file)
    let code = await compile(
      pch ? [...command.argv, '-include-pch', pch] : command.argv,
      command.object,
    )
    if (code && pch) {
      emit('Retrying without optional precompiled headers.\n')
      code = await compile(command.argv, command.object)
    }
    return code
  }

  const codes = caching?.parallelCompiler
    ? await Promise.all(commands.map(compileCommand))
    : []
  if (!caching?.parallelCompiler)
    for (const command of commands) {
      const code = await compileCommand(command)
      if (code) return code
    }
  if (codes.some((code) => code !== 0)) return codes.find((code) => code !== 0)!
}
