import { buildCacheKey } from './build-cache'
import { elfToBinary, stripElfSymbols } from './elf-binary'
import type { Session } from 'microbit-clang-wasm'

export const coldSdkVersion = 'cold-sdk-v1'

export function normalizeLinkerScript(script: string) {
  return script.replace(/\.\s*=\s*0x20\s*;/g, '. = ADDR(.text) + 0x20;')
}

export function coldSdkConfiguration(
  ez: boolean,
  commonScript = '/workspace/.browser-build/linker.ld',
) {
  const libraries = ['libpros.a', 'libc.a', 'libm.a']
  if (ez) libraries.push('EZ-Template.a', 'okapilib.a', 'liblvgl.a')
  const commonLink = [
    'ld.lld',
    '-z',
    'norelro',
    '--gc-sections',
    '-L/toolchain/lib',
    '-T',
    commonScript,
  ]
  const libraryGroup = [
    '--start-group',
    ...libraries.map((name) => `/workspace/firmware/${name}`),
    '-lgcc',
    '-lstdc++',
    '--end-group',
  ]
  const inputs = [
    ...libraries.map((name) => `/workspace/firmware/${name}`),
    '/toolchain/lib/libgcc.a',
    '/toolchain/lib/libstdc++.a',
    '/workspace/firmware/v5.ld',
    '/workspace/firmware/v5-common.ld',
  ]
  const argv = [
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
    '/workspace/.browser-build/cold.package.elf',
  ]
  return { commonLink, libraryGroup, inputs, argv }
}

export async function coldSdkDigest(
  session: Session,
  inputs: Array<string>,
  gccVersion: string,
  contentDigest?: (path: string) => Promise<string | undefined>,
) {
  const parts: Array<string | Uint8Array> = [coldSdkVersion, gccVersion]
  for (const path of inputs) {
    const bytes = contentDigest
      ? await contentDigest(path)
      : await session.readFile(path)
    if (!bytes) throw new Error(`Missing cold SDK input: ${path}`)
    parts.push(
      path,
      typeof bytes === 'string'
        ? bytes
        : await buildCacheKey([
            path.endsWith('/v5-common.ld')
              ? normalizeLinkerScript(new TextDecoder().decode(bytes))
              : bytes,
          ]),
    )
  }
  return buildCacheKey(parts)
}

export function coldSdkSymbols(elf: Uint8Array) {
  return stripElfSymbols(
    elf,
    new Set([
      'install_hot_table',
      '__libc_init_array',
      '_PROS_COMPILE_DIRECTORY',
      '_PROS_COMPILE_TIMESTAMP',
      '_PROS_COMPILE_TIMESTAMP_INT',
    ]),
  )
}

export function coldSdkBinary(elf: Uint8Array) {
  return elfToBinary(elf, new Set(['.hot_init']))
}
