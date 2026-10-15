import { patchBuildMetadata, timestampArguments } from './build-metadata'
import type { BrowserBuildSession } from './build-session'
import type { buildTimings } from './build-performance'
import { buildCacheKey, type BuildCache } from './build-cache'
import {
  coldSdkBinary,
  coldSdkConfiguration,
  coldSdkDigest,
  coldSdkSymbols,
  normalizeLinkerScript,
} from './cold-sdk'
import { elfToBinary } from './elf-binary'
import type { PrebuiltColdSdk } from './build-assets'
import type { BrowserBuildInput, BrowserBuildResult } from './browser-build'
import type { Session } from 'microbit-clang-wasm'

interface LinkContext {
  session: Session
  input: BrowserBuildInput
  gccVersion: string
  vex: boolean
  commands: Array<{ object: string }>
  run: (argv: Array<string>) => Promise<number>
  result: (
    exitCode: number,
    artifacts?: BrowserBuildResult['artifacts'],
  ) => BrowserBuildResult
  state: BrowserBuildSession
  timing: ReturnType<typeof buildTimings>
  caching?: {
    cache: BuildCache
    sdkKey: string
    metadataObject?: Uint8Array
    prebuiltCold?: {
      metadata: PrebuiltColdSdk
      symbols: Uint8Array
      binary: Uint8Array
    }
  }
  emit: (text: string) => void
  finalKey: string | undefined
  finalEligibility: { value: boolean }
  finalDependencies: Set<string>
  dependencyKey: (paths: Array<string>) => Promise<string | undefined>
}

export async function linkBrowserProgram(ctx: LinkContext) {
  const {
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
  } = ctx

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
