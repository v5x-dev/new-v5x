import { describe, expect, it } from 'bun:test'
import { browserCompileCommands, splitBuildFlags } from './browser-build'
import { elfToBinary } from './elf-binary'

describe('browser compiler arguments', () => {
  it('preserves quoted macro values without interpreting shell expressions', () => {
    expect(() =>
      splitBuildFlags('-DNAME="two words" -DVALUE=\'$(touch nope)\''),
    ).toThrow('Make expressions')
    expect(splitBuildFlags('-DNAME="two words" -Iinclude')).toEqual([
      '-DNAME=two words',
      '-Iinclude',
    ])
    expect(() => splitBuildFlags('-DVALUE=$(shell command)')).toThrow(
      'Make expressions',
    )
    expect(() => splitBuildFlags('"unterminated')).toThrow('Unterminated')
  })

  it('uses the GCC integer ABI and separate objects for nested sources', () => {
    const commands = browserCompileCommands(
      {
        files: {
          'src/a/main.cpp': '',
          'src/b/main.cpp': '',
          Makefile: 'EXTRA_CXXFLAGS += -DBUILD_TEST=1',
        },
        template: 'pros',
        commitSha: 'test',
      },
      '16.1.0',
    )
    expect(new Set(commands.map((command) => command.object)).size).toBe(2)
    expect(commands[0].argv).toContain('-D__UINT32_TYPE__=unsigned long')
    expect(commands[0].argv).toContain('-DBUILD_TEST=1')
    expect(commands[0].argv).toContain('-marm')
    expect(commands[0].argv).not.toContain('-mthumb')
  })

  it('starts EZ tasks in the ARM mode required by the PROS task wrapper', () => {
    const [command] = browserCompileCommands(
      {
        files: { 'src/main.cpp': '' },
        template: 'ez-template',
        commitSha: 'test',
      },
      '16.1.0',
    )
    expect(command.argv).toContain('-marm')
    expect(command.argv).not.toContain('-mthumb')
  })

  it('keeps imported PROS commands in ARM mode even when they request Thumb', () => {
    const [command] = browserCompileCommands(
      {
        files: {
          'compile_commands.json': JSON.stringify([
            {
              directory: '/workspace',
              file: '/workspace/src/main.cpp',
              arguments: ['clang', '-mthumb', '-c', '/workspace/src/main.cpp'],
            },
          ]),
        },
        template: 'pros',
        commitSha: 'test',
      },
      '16.1.0',
    )
    expect(command.argv.lastIndexOf('-marm')).toBeGreaterThan(
      command.argv.lastIndexOf('-mthumb'),
    )
  })

  it('rejects commands whose working directory differs from the browser workspace', () => {
    expect(() =>
      browserCompileCommands(
        {
          files: {
            'compile_commands.json': JSON.stringify([
              {
                directory: '/tmp',
                file: '/workspace/src/main.cpp',
                arguments: ['clang', '-c', '/workspace/src/main.cpp'],
              },
            ]),
          },
          template: 'vexcode',
          commitSha: 'test',
        },
        '16.1.0',
      ),
    ).toThrow('/workspace')
  })
})

describe('V5 binary conversion', () => {
  it('rejects truncated or foreign executable formats', () => {
    expect(() => elfToBinary(new Uint8Array(10))).toThrow('Truncated')
    expect(() => elfToBinary(new Uint8Array(52))).toThrow('ELF32 ARM')
  })
})
