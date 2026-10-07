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
