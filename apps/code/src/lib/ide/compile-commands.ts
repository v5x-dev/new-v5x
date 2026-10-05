export type ProjectTemplate =
  'vexcode' | 'pros' | 'ez-template' | 'jar-template'
export interface CompileCommand {
  directory: string
  file: string
  arguments: Array<string>
}

export function compileCommands(
  files: Record<string, string>,
  template: ProjectTemplate,
  gccVersion: string,
  extraFlags: Array<string> = [],
): Array<CompileCommand> {
  // Imported commands must already describe the browser filesystem. Never execute a shell command from a project.
  if (files['compile_commands.json']) {
    const commands: unknown = JSON.parse(files['compile_commands.json'])
    if (
      !Array.isArray(commands) ||
      commands.some(
        (c) =>
          !c ||
          typeof c.directory !== 'string' ||
          typeof c.file !== 'string' ||
          !Array.isArray(c.arguments) ||
          c.arguments.some((a: unknown) => typeof a !== 'string'),
      )
    )
      throw new Error(
        'compile_commands.json must contain directory, file, and arguments entries mapped to /workspace',
      )
    return commands as Array<CompileCommand>
  }
  const vex = template === 'vexcode' || template === 'jar-template'
  const flags = vex
    ? [
        '--target=thumbv7-none-eabi',
        '-march=armv7-a',
        '-mfpu=neon',
        '-mfloat-abi=softfp',
        '-fshort-enums',
        '-fno-rtti',
        '-fno-exceptions',
        '-fno-threadsafe-statics',
        '-DVexV5',
        '-D__INT32_TYPE__=long',
        '-D__UINT32_TYPE__=unsigned long',
        '-I/sdk/vexv5/include',
        '-isystem',
        '/sdk/vexv5/gcc/include/c++/4.9.3',
        '-isystem',
        '/sdk/vexv5/gcc/include/c++/4.9.3/arm-none-eabi/armv7-ar/thumb',
        '-isystem',
        '/sdk/vexv5/gcc/include',
        '-resource-dir=/sdk/vexv5/clang/8.0.0',
      ]
    : [
        '--target=arm-none-eabi',
        '-mcpu=cortex-a9',
        '-mfpu=neon-fp16',
        '-mfloat-abi=softfp',
        '-mthumb',
        '-D_POSIX_THREADS',
        '-isystem',
        `/toolchain/include/c++/${gccVersion}`,
        '-isystem',
        `/toolchain/include/c++/${gccVersion}/arm-none-eabi/thumb/v7+fp/softfp`,
        '-isystem',
        `/toolchain/include/c++/${gccVersion}/arm-none-eabi`,
        '-isystem',
        '/toolchain/include',
        '-resource-dir=/sdk/vexv5/clang/8.0.0',
      ]
  return Object.keys(files)
    .filter((path) => /\.(c|cc|cpp|cxx)$/.test(path))
    .map((path) => ({
      directory: '/workspace',
      file: `/workspace/${path}`,
      arguments: [
        'clang',
        '-x',
        path.endsWith('.c') ? 'c' : 'c++',
        `-std=${path.endsWith('.c') ? 'gnu99' : vex ? 'gnu++11' : 'gnu++17'}`,
        ...flags,
        '-I/workspace/include',
        ...extraFlags,
        '-c',
        `/workspace/${path}`,
      ],
    }))
}
