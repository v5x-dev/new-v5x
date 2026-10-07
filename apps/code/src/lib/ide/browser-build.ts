import { compileCommands } from './compile-commands'
import { buildCacheKey, dependencyPaths } from './build-cache'
import { validPath } from './workspace'
import { elfToBinary, stripElfSymbols } from './elf-binary'
import type { BuildCache } from './build-cache'
import type { Session } from 'microbit-clang-wasm'
import type { ProjectTemplate } from './compile-commands'

export interface BrowserBuildInput {
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
          '-Os',
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
  caching?: { cache: BuildCache; sdkKey: string },
): Promise<BrowserBuildResult> {
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
    emit(`${argv.join(' ')}\n`)
    return session.run(argv, { stdout: stream, stderr: stream })
  }
  const result = (
    exitCode: number,
    artifacts: BrowserBuildResult['artifacts'] = [],
  ) => ({ commitSha: input.commitSha, exitCode, output, artifacts })

  for (const [path, contents] of Object.entries(input.files)) {
    if (!validPath(path)) throw new Error(`Invalid project path: ${path}`)
    await session.writeFile(`/workspace/${path}`, contents)
  }
  const commands = browserCompileCommands(input, gccVersion)
  const namespace = caching
    ? await buildCacheKey([
        'clang-21.11.0-browser-build-v2',
        caching.sdkKey,
        JSON.stringify(Object.keys(input.files).sort()),
      ])
    : ''
  const dependencyKey = async (paths: Array<string>) => {
    const parts: Array<string | Uint8Array> = []
    for (const path of paths) {
      const contents = await session.readFile(path)
      if (!contents) return undefined
      // These macros depend on the build clock, not just file contents.
      if (
        /__DATE__|__TIME__|__TIMESTAMP__/.test(
          new TextDecoder().decode(contents),
        )
      )
        return undefined
      parts.push(path, contents)
    }
    return buildCacheKey(parts)
  }
  const compile = async (argv: Array<string>, object: string) => {
    const enabled =
      Boolean(caching) &&
      !argv.some((arg) => /__DATE__|__TIME__|__TIMESTAMP__/.test(arg))
    const key = enabled
      ? await buildCacheKey([namespace, JSON.stringify(argv)])
      : ''
    if (enabled && caching) {
      const manifest = await caching.cache.get(key)
      if (manifest) {
        try {
          const { paths, digest } = JSON.parse(
            new TextDecoder().decode(manifest),
          ) as { paths: Array<string>; digest: string }
          if (paths.length && (await dependencyKey(paths)) === digest) {
            const bytes = await caching.cache.get(
              await buildCacheKey([key, digest]),
            )
            if (bytes) {
              await session.writeFile(object, bytes)
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
    const depfile = object + '.d'
    const code = await run(enabled ? [...argv, '-MD', '-MF', depfile] : argv)
    if (!code && enabled && caching) {
      const dependencies = await session.readFile(depfile)
      const bytes = await session.readFile(object)
      const paths = dependencies
        ? dependencyPaths(new TextDecoder().decode(dependencies))
        : []
      const digest = paths.length ? await dependencyKey(paths) : undefined
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
  const pchCommands =
    input.template === 'ez-template' && input.files['include/main.h']
      ? commands.filter(
          (command) =>
            /\.cpp$/.test(command.file) &&
            /^\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*#\s*include\s*"main\.h"/.test(
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
  const precompiled = await session.readFile('/sdk/ez/main-pch.json')
  if (precompiled) {
    const metadata = JSON.parse(new TextDecoder().decode(precompiled)) as {
      arguments: Array<string>
      paths: Array<string>
      digest: string
      workspacePaths: Array<string>
    }
    for (const [args, group] of groups) {
      if (
        args !== JSON.stringify(metadata.arguments) ||
        JSON.stringify(Object.keys(input.files).sort()) !==
          JSON.stringify(metadata.workspacePaths)
      )
        continue
      if ((await dependencyKey(metadata.paths)) !== metadata.digest) continue
      for (const command of group)
        pchBySource.set(command.file, '/sdk/ez/main.pch')
    }
    if (pchBySource.size) emit('Using checked EZ precompiled headers.\n')
  }
  for (const command of commands) {
    const pch = pchBySource.get(command.file)
    const code = await compile(
      pch ? [...command.argv, '-include-pch', pch] : command.argv,
      command.object,
    )
    if (code) return result(code)
  }

  const vex = input.template === 'vexcode' || input.template === 'jar-template'
  const elf = '/workspace/.browser-build/program.elf'
  const objects = commands.map((command) => command.object)
  // GNU ld treats this assignment as an offset inside .text. LLD treats
  // it as an absolute address. Preserve the 32-byte V5 boot header explicitly.
  const scriptPath = vex
    ? '/sdk/vexv5/lscript.ld'
    : '/workspace/firmware/v5-common.ld'
  const script = await session.readFile(scriptPath)
  if (!script) throw new Error('V5 linker script is missing')
  await session.writeFile(
    scriptPath,
    new TextDecoder()
      .decode(script)
      .replace(/\.\s*=\s*0x20\s*;/g, '. = ADDR(.text) + 0x20;'),
  )
  let link: Array<string>
  if (vex) {
    link = [
      'ld.lld',
      '-z',
      'norelro',
      '-T',
      '/sdk/vexv5/lscript.ld',
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
    await session.writeFile(
      timestamp,
      `const int _PROS_COMPILE_TIMESTAMP_INT = ${Math.floor(Date.now() / 1000)};\n` +
        'const char * const _PROS_COMPILE_TIMESTAMP = __DATE__ " " __TIME__;\n' +
        'const char * const _PROS_COMPILE_DIRECTORY = "/workspace";\n',
    )
    const code = await run([
      'clang',
      '--target=arm-none-eabi',
      '-mcpu=cortex-a9',
      '-mthumb',
      '-mfpu=neon-fp16',
      '-mfloat-abi=softfp',
      '-c',
      timestamp,
      '-o',
      timestampObject,
    ])
    if (code) return result(code)
    const libraries = ['libpros.a', 'libc.a', 'libm.a']
    if (input.template === 'ez-template')
      libraries.push('EZ-Template.a', 'okapilib.a', 'liblvgl.a')
    const coldElf = '/workspace/.browser-build/cold.package.elf'
    const commonLink = [
      'ld.lld',
      '-z',
      'norelro',
      '--gc-sections',
      '-L/toolchain/lib',
      '-T',
      '/workspace/firmware/v5-common.ld',
    ]
    const libraryGroup = [
      '--start-group',
      ...libraries.map((name) => `/workspace/firmware/${name}`),
      '-lgcc',
      '-lstdc++',
      '--end-group',
    ]
    const coldInputs = [
      ...libraries.map((name) => `/workspace/firmware/${name}`),
      '/toolchain/lib/libgcc.a',
      '/toolchain/lib/libstdc++.a',
      '/workspace/firmware/v5.ld',
      '/workspace/firmware/v5-common.ld',
    ]
    const coldParts: Array<string | Uint8Array> = ['cold-link-v2', gccVersion]
    if (caching) {
      coldParts.push(caching.sdkKey)
      for (const path of coldInputs) {
        const contents = await session.readFile(path)
        if (!contents) throw new Error(`Missing cold SDK input: ${path}`)
        coldParts.push(path, contents)
      }
    }
    const coldKey = caching ? await buildCacheKey(coldParts) : ''
    let coldExecutable = caching ? await caching.cache.get(coldKey) : undefined
    if (!coldExecutable) {
      // Keep every cold library section for programs that reference it later.
      // LLD cannot apply GNU ld's --gc-keep-exported to this static ARM image.
      const coldCode = await run([
        ...commonLink,
        '--no-gc-sections',
        '--whole-archive',
        ...libraries
          .filter((name) => name !== 'libc.a' && name !== 'libm.a')
          .map((name) => `/workspace/firmware/${name}`),
        '-lstdc++',
        '--no-whole-archive',
        ...libraryGroup,
        '-T',
        '/workspace/firmware/v5.ld',
        '-o',
        coldElf,
      ])
      if (coldCode) return result(coldCode)
      coldExecutable = (await session.readFile(coldElf)) ?? undefined
      if (!coldExecutable?.byteLength)
        throw new Error('Linker produced an empty cold executable')
      if (caching) await caching.cache.put(coldKey, coldExecutable)
    } else emit('Reused cold SDK package.\n')
    // Match the per-program symbols stripped by upstream common.mk.
    await session.writeFile(
      coldElf,
      stripElfSymbols(
        coldExecutable,
        new Set([
          'install_hot_table',
          '__libc_init_array',
          '_PROS_COMPILE_DIRECTORY',
          '_PROS_COMPILE_TIMESTAMP',
          '_PROS_COMPILE_TIMESTAMP_INT',
        ]),
      ),
    )
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
    const hot = elfToBinary(hotExecutable, new Set(), 0x07800000)
    const cold = elfToBinary(coldExecutable, new Set(['.hot_init']))
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
  const bytes = elfToBinary(executable)
  emit(`Built ${bytes.byteLength} bytes in this browser.\n`)
  return result(0, [{ path: 'build/workspace.bin', bytes }])
}
