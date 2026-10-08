import { patchBuildMetadata, timestampArguments } from './build-metadata'
import {
  BrowserBuildSession,
  includeInventory,
  validDependencyRecord,
} from './build-session'
import { buildTimings } from './build-performance'
import { compileCommands } from './compile-commands'
import { buildCacheKey, dependencyPaths } from './build-cache'
import { validPath } from './workspace'
import {
  coldSdkBinary,
  coldSdkConfiguration,
  coldSdkDigest,
  coldSdkSymbols,
  normalizeLinkerScript,
} from './cold-sdk'
import { elfToBinary } from './elf-binary'
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

// A small, explicit argument format. Shell expressions and make expansions cannot
// run inside the browser. Custom projects can provide compile_commands.json.
export function splitBuildFlags(value: string): Array<string> {
  const result: Array<string> = []
  let word = ''
  let quote = ''
  let escaped = false
  let started = false
  for (const char of value) {
    if (escaped) {
      word += char
      escaped = false
    } else if (char === '\\' && quote !== "'") {
      escaped = true
      started = true
    } else if (quote) {
      if (char === quote) quote = ''
      else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) result.push(word)
      word = ''
      started = false
    } else {
      word += char
      started = true
    }
  }
  if (quote || escaped) throw new Error('Unterminated build flag')
  if (started) result.push(word)
  if (result.some((flag) => flag.includes('$(') || flag.includes('${')))
    throw new Error(
      'Make expressions in build flags require explicit compile_commands.json',
    )
  return result
}

function extraFlags(files: Record<string, string>, cxx: boolean, vex: boolean) {
  const name = vex
    ? cxx
      ? 'CXX_FLAGS'
      : 'CFLAGS'
    : cxx
      ? 'EXTRA_CXXFLAGS'
      : 'EXTRA_CFLAGS'
  let flags: Array<string> = []
  for (const line of (files.Makefile || files.makefile || '').split('\n')) {
    const match = /^\s*(\w+)\s*(:=|\+=|=|\?=)\s*(.*?)\s*$/.exec(line)
    if (!match || match[1] !== name) continue
    const values = splitBuildFlags(match[3].replace(/\s+#.*$/, ''))
    if (match[2] === '+=') flags.push(...values)
    else if (match[2] !== '?=' || flags.length === 0) flags = values
  }
  if (!vex) {
    const standardName = cxx ? 'CXX_STANDARD' : 'C_STANDARD'
    for (const line of (files.Makefile || '').split('\n')) {
      const match = /^\s*(\w+)\s*[:?]?=\s*([\w+]+)\s*(?:#.*)?$/.exec(line)
      if (match?.[1] === standardName) flags.push(`-std=${match[2]}`)
    }
  }
  return flags
}

function workspaceArguments(args: Array<string>, file: string) {
  const pathFlags = new Set([
    '-I',
    '-isystem',
    '-iquote',
    '-include',
    '-imacros',
    '-isysroot',
    '--sysroot',
  ])
  const absolute = (path: string) =>
    path.startsWith('/') ? path : `/workspace/${path.replace(/^\.\//, '')}`
  const result: Array<string> = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '-o') {
      index++
      continue
    }
    if (arg.startsWith('-o') && arg.length > 2) continue
    if (pathFlags.has(arg)) {
      if (!args[index + 1]) throw new Error(`Missing path after ${arg}`)
      result.push(arg, absolute(args[++index]))
    } else if (arg.startsWith('-I') && arg.length > 2)
      result.push(`-I${absolute(arg.slice(2))}`)
    else result.push(arg === file.slice('/workspace/'.length) ? file : arg)
  }
  if (!result.includes('-c')) result.push('-c')
  return result
}

export function browserCompileCommands(
  input: BrowserBuildInput,
  gccVersion: string,
) {
  const vex = input.template === 'vexcode' || input.template === 'jar-template'
  const generated = compileCommands(input.files, input.template, gccVersion)
  if (!input.files['compile_commands.json']) {
    for (const path of Object.keys(input.files).filter(
      (candidate) => candidate.startsWith('src/') && /\.[sS]$/.test(candidate),
    )) {
      const [command] = compileCommands(
        { [`${path}.c`]: '' },
        input.template,
        gccVersion,
      )
      command.file = `/workspace/${path}`
      command.arguments = command.arguments
        .map((arg) =>
          arg === `/workspace/${path}.c`
            ? command.file
            : arg === 'c'
              ? 'assembler-with-cpp'
              : arg,
        )
        .filter((arg) => !arg.startsWith('-std='))
      generated.push(command)
    }
  }
  const commands = generated
    .filter(
      (command) =>
        input.files['compile_commands.json'] ||
        command.file.startsWith('/workspace/src/'),
    )
    .map((command) => {
      if (
        command.directory !== '/workspace' ||
        !validPath(command.file.slice('/workspace/'.length))
      )
        throw new Error('Browser compile commands must use /workspace paths')
      const cxx = /\.(cc|cpp|cxx|c\+\+)$/.test(command.file)
      const arguments_ = command.arguments
        .slice(1)
        .filter((arg) => !arg.startsWith('-resource-dir='))
      if (!input.files['compile_commands.json']) {
        arguments_.push(
          `-${input.experiments?.optimization ?? 'Os'}`,
          '-ffunction-sections',
          '-fdata-sections',
          '-fno-diagnostics-color',
        )
        // Match the GCC typedefs used by the prebuilt C++ SDK libraries.
        for (const macro of [
          '-D__INT32_TYPE__=long',
          '-D__UINT32_TYPE__=unsigned long',
        ]) {
          const index = arguments_.indexOf(macro)
          if (index >= 0) arguments_.splice(index, 1)
        }
        arguments_.push(
          '-U__INT32_TYPE__',
          '-U__UINT32_TYPE__',
          '-D__INT32_TYPE__=long',
          '-D__UINT32_TYPE__=unsigned long',
        )
        if (!vex) {
          arguments_.push(
            '-D_UNIX98_THREAD_MUTEX_ATTRIBUTES',
            '-D_POSIX_TIMERS',
            '-D_POSIX_MONOTONIC_CLOCK',
            '-funwind-tables',
          )
          if (input.template === 'ez-template') {
            const standard = arguments_.indexOf('-std=gnu++17')
            if (standard >= 0) arguments_[standard] = '-std=gnu++20'
            arguments_.push(
              '-D_PROS_INCLUDE_LIBLVGL_LLEMU_H',
              '-D_PROS_INCLUDE_LIBLVGL_LLEMU_HPP',
              '-I/workspace/include/okapi/squiggles',
            )
          }
        }
        arguments_.push(...extraFlags(input.files, cxx, vex))
      }
      // This also applies to imported compile commands and custom flags.
      // PROS's ARM task trampoline cannot start a Thumb user task.
      if (!vex) arguments_.push('-marm')
      const optimizationIndex =
        arguments_.length -
        1 -
        [...arguments_]
          .reverse()
          .findIndex((arg) => /^-O(?:[0-3sgz]|fast)$/.test(arg))
      for (let index = optimizationIndex - 1; index >= 0; index--)
        if (/^-O(?:[0-3sgz]|fast)$/.test(arguments_[index]))
          arguments_.splice(index, 1)
      // Each source has its own object, including equal basenames in different folders.
      const object = `/workspace/.browser-build/${command.file.slice('/workspace/'.length)}.o`
      return {
        file: command.file,
        object,
        argv: [
          'clang',
          ...workspaceArguments(arguments_, command.file),
          '-o',
          object,
        ],
      }
    })
  if (!commands.length) throw new Error('No source files found under src/')
  return commands
}

export function browserPchArguments(command: {
  argv: Array<string>
  file: string
}) {
  return command.argv.filter(
    (arg, index, args) =>
      arg !== command.file &&
      arg !== '-c' &&
      arg !== '-o' &&
      args[index - 1] !== '-o' &&
      arg !== '-x' &&
      args[index - 1] !== '-x',
  )
}

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
      () => session.run(argv, { stdout: stream, stderr: stream }),
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
  const dependencyKey = async (paths: Array<string>) => {
    const parts: Array<string | Uint8Array> = []
    for (const path of paths) {
      const digest = await state.dependencyDigest(path)
      if (!digest) return undefined
      parts.push(path, digest)
    }
    return buildCacheKey(parts)
  }
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
    (input.template === 'ez-template' ||
      input.experiments?.pch === 'project') &&
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
      if (pchBySource.size) emit('Using checked EZ precompiled headers.\n')
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
      if (code) return result(code)
    }
  if (codes.some((code) => code !== 0))
    return result(codes.find((code) => code !== 0)!)

  const elf = '/workspace/.browser-build/program.elf'
  const objects = commands.map((command) => command.object)
  // GNU ld treats this assignment as an offset inside .text. LLD treats
  // it as an absolute address. Preserve the 32-byte V5 boot header explicitly.
  const scriptPath = vex
    ? '/sdk/vexv5/lscript.ld'
    : '/workspace/firmware/v5-common.ld'
  const script = await session.readFile(scriptPath)
  if (!script) throw new Error('V5 linker script is missing')
  await state.writeFile(
    '/workspace/.browser-build/linker.ld',
    normalizeLinkerScript(new TextDecoder().decode(script)),
  )
  let link: Array<string>
  if (vex) {
    link = [
      'ld.lld',
      '-z',
      'norelro',
      '-T',
      '/workspace/.browser-build/linker.ld',
      '--just-symbols=/sdk/vexv5/stdlib_0.lib',
      '--gc-sections',
      '-L/sdk/vexv5',
      '-L/sdk/vexv5/gcc/libs',
      ...objects,
      '--start-group',
      '-lv5rt',
      '-lstdc++',
      '-lc',
      '-lm',
      '-lgcc',
      '--end-group',
      '-o',
      elf,
    ]
  } else {
    const timestamp = '/workspace/.browser-build/timestamp.c'
    const timestampObject = `${timestamp}.o`
    const patchedMetadata =
      input.experiments?.metadata !== 'compile' && caching?.metadataObject
        ? await timing.measure('timestamp-patch', () =>
            Promise.resolve(patchBuildMetadata(caching.metadataObject!)),
          )
        : undefined
    if (patchedMetadata) {
      await state.writeFile(timestampObject, patchedMetadata)
    } else {
      await state.writeFile(
        timestamp,
        `const int _PROS_COMPILE_TIMESTAMP_INT = ${Math.floor(Date.now() / 1000)};\n` +
          'const char * const _PROS_COMPILE_TIMESTAMP = __DATE__ " " __TIME__;\n' +
          'const char * const _PROS_COMPILE_DIRECTORY = "/workspace";\n',
      )
      const code = await run(timestampArguments(timestamp, timestampObject))
      if (code) return result(code)
    }
    const coldElf = '/workspace/.browser-build/cold.package.elf'
    const {
      commonLink,
      libraryGroup,
      inputs: coldInputs,
      argv: coldArgv,
    } = coldSdkConfiguration(input.template === 'ez-template')
    const effectiveDigest = await timing.measure('cold-input-validation', () =>
      coldSdkDigest(session, coldInputs, gccVersion, (path) =>
        state.linkerDigest(path),
      ),
    )
    const prebuilt =
      input.experiments?.prebuiltCold !== false &&
      caching?.prebuiltCold?.metadata.inputsDigest === effectiveDigest
        ? caching.prebuiltCold
        : undefined
    const coldKey = caching
      ? await buildCacheKey(['cold-link-v3', caching.sdkKey, effectiveDigest])
      : ''
    let coldExecutable = caching ? await caching.cache.get(coldKey) : undefined
    if (!coldExecutable && !prebuilt) {
      // Keep every cold library section for programs that reference it later.
      // LLD cannot apply GNU ld's --gc-keep-exported to this static ARM image.
      const coldCode = await run(coldArgv)
      if (coldCode) return result(coldCode)
      coldExecutable = (await session.readFile(coldElf)) ?? undefined
      if (!coldExecutable?.byteLength)
        throw new Error('Linker produced an empty cold executable')
      if (caching) await caching.cache.put(coldKey, coldExecutable)
    } else emit('Reused cold SDK package.\n')
    const derivedKey = await buildCacheKey(['cold-derived-v1', coldKey])
    const symbolsKey = await buildCacheKey([derivedKey, 'symbols'])
    const binaryKey = await buildCacheKey([derivedKey, 'binary'])
    let symbols =
      prebuilt?.symbols ??
      (caching ? await caching.cache.get(symbolsKey) : undefined)
    let cold =
      prebuilt?.binary ??
      (caching ? await caching.cache.get(binaryKey) : undefined)
    // Match the per-program symbols stripped by upstream common.mk.
    if (!symbols) {
      symbols = await timing.measure('cold-symbol-transformation', () =>
        Promise.resolve(coldSdkSymbols(coldExecutable!)),
      )
      if (caching) await caching.cache.put(symbolsKey, symbols)
    }
    await state.writeFile(coldElf, symbols)
    if (!cold) {
      cold = await timing.measure('cold-binary-conversion', () =>
        Promise.resolve(coldSdkBinary(coldExecutable!)),
      )
      if (caching) await caching.cache.put(binaryKey, cold)
    }
    const hotCode = await run([
      ...commonLink,
      `--just-symbols=${coldElf}`,
      ...objects,
      timestampObject,
      ...libraryGroup,
      '-T',
      '/workspace/firmware/v5-hot.ld',
      '-o',
      elf,
    ])
    if (hotCode) return result(hotCode)
    const hotExecutable = await session.readFile(elf)
    if (!hotExecutable?.byteLength)
      throw new Error('Linker produced an empty hot executable')
    const hot = await timing.measure('hot-binary-conversion', () =>
      Promise.resolve(elfToBinary(hotExecutable, new Set(), 0x07800000)),
    )
    emit(
      `Built ${hot.byteLength + cold.byteLength} bytes in this browser (hot: ${hot.byteLength}, cold: ${cold.byteLength}).\n`,
    )
    return result(0, [
      { path: 'bin/hot.package.bin', bytes: hot },
      { path: 'bin/cold.package.bin', bytes: cold },
    ])
  }
  const code = await run(link)
  if (code) return result(code)
  const executable = await session.readFile(elf)
  if (!executable?.byteLength)
    throw new Error('Linker produced an empty executable')
  const bytes = await timing.measure('binary-conversion', () =>
    Promise.resolve(elfToBinary(executable)),
  )
  if (finalKey && caching && finalEligibility.value) {
    // Link inputs are dependencies too. SDK generation covers immutable libraries.
    finalDependencies.add(scriptPath)
    const paths = [...finalDependencies].sort()
    const digest = await dependencyKey(paths)
    if (digest) {
      await caching.cache.put(
        await buildCacheKey([finalKey, digest, 'binary']),
        bytes,
      )
      await caching.cache.put(
        finalKey,
        new TextEncoder().encode(JSON.stringify({ paths, digest })),
      )
    }
  }
  emit(`Built ${bytes.byteLength} bytes in this browser.\n`)
  return result(0, [{ path: 'build/workspace.bin', bytes }])
}
