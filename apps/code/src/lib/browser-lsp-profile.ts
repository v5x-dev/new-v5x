import type { RobotTemplate, WorkspaceFile } from './browser-lsp-types'

export function compilationDatabase(
  template: RobotTemplate,
  files: WorkspaceFile[],
  includePaths: string[],
) {
  const vex = template === 'vexcode' || template === 'jar-template'
  const common = [
    '--target=arm-none-eabi',
    '-mcpu=cortex-a9',
    vex ? '-mfpu=neon' : '-mfpu=neon-fp16',
    '-mfloat-abi=softfp',
    ...(vex ? ['-mthumb', '-fshort-enums'] : []),
    '-ffunction-sections',
    '-fdata-sections',
    '-nostdinc',
    '-nostdinc++',
    '-Wno-unknown-attributes',
    '-I/workspace/include',
    ...includePaths.flatMap((path) => ['-isystem', path]),
    ...(vex
      ? [
          '-DVexV5',
          '-U__INT32_TYPE__',
          '-U__UINT32_TYPE__',
          '-D__INT32_TYPE__=long',
          '-D__UINT32_TYPE__=unsigned long',
        ]
      : [
          '-D_POSIX_THREADS',
          '-D_UNIX98_THREAD_MUTEX_ATTRIBUTES',
          '-D_POSIX_TIMERS',
          '-D_POSIX_MONOTONIC_CLOCK',
          ...(template === 'ez-template'
            ? [
                '-D_PROS_INCLUDE_LIBLVGL_LLEMU_H',
                '-D_PROS_INCLUDE_LIBLVGL_LLEMU_HPP',
              ]
            : []),
        ]),
  ]
  const overrides = files.find((file) => file.path === '.v5x-lsp.json')
  let extra: string[] = []
  if (overrides) {
    const config: unknown = JSON.parse(overrides.contents)
    if (
      !config ||
      typeof config !== 'object' ||
      !('flags' in config) ||
      !Array.isArray(config.flags) ||
      !config.flags.every((flag) => typeof flag === 'string')
    )
      throw new Error('.v5x-lsp.json must contain a flags array of strings')
    extra = config.flags
  }
  return files
    .filter((file) => /\.(c|cc|cpp|cxx|c\+\+)$/i.test(file.path))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(({ path }) => ({
      directory: '/workspace',
      file: `/workspace/${path}`,
      arguments: [
        path.endsWith('.c') ? 'clang' : 'clang++',
        ...common,
        ...(path.endsWith('.c')
          ? [vex ? '-std=gnu99' : '-std=gnu11']
          : [
              '-std=' +
                (template === 'vexcode'
                  ? 'gnu++11'
                  : template === 'ez-template'
                    ? 'gnu++20'
                    : 'gnu++17'),
              ...(vex
                ? ['-fno-rtti', '-fno-exceptions', '-fno-threadsafe-statics']
                : []),
            ]),
        ...extra,
        '-c',
        `/workspace/${path}`,
      ],
    }))
}
