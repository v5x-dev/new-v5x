import { compileCommands } from './compile-commands'
import { validPath } from './workspace-path'
import type { BrowserBuildInput } from './browser-build'

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
