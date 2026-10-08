// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- Include the Bun adapter package ambient declaration without a runtime import.
/// <reference path="../../../packages/serial/src/adapters/bun-serialport.d.ts" />
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createSession, setAssetLoader } from 'microbit-clang-wasm'
import { templateFiles } from '../convex/template'
import { compileBrowserProject } from '../src/lib/ide/browser-build'
import { BrowserBuildSession } from '../src/lib/ide/build-session'
import {
  GetDirectoryEntryH2DPacket,
  GetDirectoryEntryReplyD2HPacket,
  GetDirectoryFileCountH2DPacket,
  GetDirectoryFileCountReplyD2HPacket,
  PacketEncoder,
} from '../../../packages/serial/src/vex/vex-packet'
import {
  FileDownloadTarget,
  FileExitAction,
  FileVendor,
} from '../../../packages/serial/src/vex/vex'
import { ProgramIniConfig } from '../../../packages/serial/src/vex/vex-ini-config'
import { V5SerialConnection } from '../../../packages/serial/src/vex/vex-connection'
import { createBunAdapter } from '../../../packages/serial/src/adapters/bun'
import { readSdkBundle } from './read-sdk-bundle'
import type { AdapterSerialPort } from '../../../packages/serial/src/adapters/serial-adapter'
import type { BuildSdkManifest } from '../src/lib/ide/build-assets'
import type { BrowserBuildInput } from '../src/lib/ide/browser-build'
import type { ProgramTemplate } from '../convex/template'
import type { BuildTimingEvent } from '../src/lib/ide/build-performance'

// Explicit hardware runner. Fixtures have no motor commands. Reserve a free slot,
// use private library names, and remove only files created by this invocation.
const publicDir = resolve(import.meta.dir, '../public')
const outputDir = resolve(import.meta.dir, '../../../.build/brain-verification')
const variants = ['reference', 'optimized', 'O0', 'O1', 'project-pch']
type Fixture = {
  template: ProgramTemplate
  variant: string
  compiledAt: number
  compileMs: number
  commitSha: string
  artifacts: Array<{ path: string; file: string; bytes: number }>
  spans: Array<BuildTimingEvent>
}
const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, 'utf8'))
const assetBytes = async (asset: { url: string; compression?: string }) => {
  const bytes = await readFile(resolve(publicDir, asset.url.slice(1)))
  return asset.compression === 'gzip'
    ? new Uint8Array(gunzipSync(bytes))
    : new Uint8Array(bytes)
}

function fixtureFiles(template: ProgramTemplate, variant: string) {
  const packaged = template === 'pros' || template === 'ez-template'
  const header = packaged ? 'main.h' : 'vex.h'
  const files = Object.fromEntries(
    Object.entries(templateFiles[template]).filter(
      ([path]) => !/^src\/.*\.(cpp|c|s)$/i.test(path),
    ),
  )
  files['src/helper.cpp'] = `#include "${header}"
#include <vector>
#include <numeric>
int hardware_value() { std::vector<int> values{1, 4, 9, 16}; return std::accumulate(values.begin(), values.end(), 0); }
`
  const marker = `V5X_HW_OK ${template} ${variant}`
  const main = packaged
    ? `
#include "main.h"
#include <cstdio>
extern int hardware_value();
extern "C" { extern const int _PROS_COMPILE_TIMESTAMP_INT; extern const char *const _PROS_COMPILE_TIMESTAMP; }
void runtime_task() {
  pros::screen::print(pros::E_TEXT_MEDIUM, 1, "V5X_HW_OK ${template} ${variant}");
  pros::screen::print(pros::E_TEXT_MEDIUM, 2, "value=%d", hardware_value());
  pros::screen::print(pros::E_TEXT_MEDIUM, 3, "meta=%d", _PROS_COMPILE_TIMESTAMP_INT);
  pros::screen::print(pros::E_TEXT_MEDIUM, 4, "%s", _PROS_COMPILE_TIMESTAMP);
  for (;;) {
    std::printf("${marker} value=%d macro=%s %s meta=%d %s\\n", hardware_value(), __DATE__, __TIME__, _PROS_COMPILE_TIMESTAMP_INT, _PROS_COMPILE_TIMESTAMP);
    std::fflush(stdout);
    pros::delay(500);
  }
}
void initialize() { pros::Task task(runtime_task); }
void disabled() {}
void competition_initialize() {}
void autonomous() {}
void opcontrol() { while (true) pros::delay(20); }
`
    : `
#include "vex.h"
#include "v5_api.h"
extern int hardware_value();
int runtime_task() {
  for (;;) {
    vexDisplayString(1, "V5X_HW_OK ${template} ${variant}");
    vexDisplayString(2, "value=%d", hardware_value());
    vexDisplayString(3, "%s %s", __DATE__, __TIME__);
    printf("${marker} value=%d macro=%s %s\\n", hardware_value(), __DATE__, __TIME__);
    vex::task::sleep(500);
  }
  return 0;
}
int main() { vex::task task(runtime_task); while (true) vex::task::sleep(20); }
`
  files['src/main.cpp'] = main.trimStart()
  return files
}

async function prepare() {
  await mkdir(outputDir, { recursive: true })
  const headers = await readJson<BuildSdkManifest>(
    resolve(publicDir, 'language/sdk-manifest.json'),
  )
  const libraries = await readJson<BuildSdkManifest>(
    resolve(publicDir, 'compiler/sdk-manifest.json'),
  )
  setAssetLoader((name) =>
    readFile(resolve(publicDir, 'compiler/llvm-21.11.0-alpha.1', name)),
  )
  const fixtures: Array<Fixture> = []
  for (const template of Object.keys(templateFiles) as Array<ProgramTemplate>) {
    const state = new BrowserBuildSession(createSession())
    for (const manifest of [headers, libraries])
      for (const name of manifest.templates[template]!)
        await state.mount(
          await readSdkBundle(
            resolve(publicDir, manifest.bundles[name]!.url.slice(1)),
            manifest === libraries,
          ),
        )
    const cold = libraries.cold?.[template]
    const prebuiltCold = cold
      ? {
          metadata: cold,
          symbols: await assetBytes(cold.symbols),
          binary: await assetBytes(cold.binary),
        }
      : undefined
    const metadataObject = libraries.metadataObject
      ? await assetBytes(libraries.metadataObject.asset)
      : undefined
    for (const variant of variants) {
      const experiments: BrowserBuildInput['experiments'] =
        variant === 'reference'
          ? {
              cache: false,
              pch: 'off',
              starter: false,
              prebuiltCold: false,
              metadata: 'compile',
            }
          : variant === 'O0' || variant === 'O1'
            ? { optimization: variant, pch: 'off', starter: false }
            : {
                pch: variant === 'project-pch' ? 'project' : 'off',
                starter: false,
              }
      const commitSha = `hardware-${template}-${variant}`
      const spans: Array<BuildTimingEvent> = []
      const compiledAt = Date.now(),
        start = performance.now()
      const result = await compileBrowserProject(
        state.session,
        {
          files: fixtureFiles(template, variant),
          template,
          commitSha,
          buildId: commitSha,
          experiments,
        },
        headers.gccVersion,
        () => {},
        {
          state,
          sdkKey: 'hardware-fixture',
          metadataObject,
          prebuiltCold,
          cache: {
            get: () => Promise.resolve(undefined),
            put: () => Promise.resolve(),
          },
          timing: (event) => spans.push(event),
        },
      )
      if (result.exitCode) throw new Error(result.output)
      const linked = await state.session.readFile(
        '/workspace/.browser-build/program.elf',
      )
      if (linked)
        await writeFile(
          resolve(outputDir, `${template}-${variant}.elf`),
          linked,
        )
      const artifacts = []
      for (const artifact of result.artifacts) {
        const file = `${template}-${variant}-${artifact.path.split('/').at(-1)}`
        await writeFile(resolve(outputDir, file), artifact.bytes)
        artifacts.push({
          path: artifact.path,
          file,
          bytes: artifact.bytes.length,
        })
      }
      fixtures.push({
        template,
        variant,
        compiledAt,
        compileMs: performance.now() - start,
        commitSha,
        artifacts,
        spans,
      })
      console.log(
        `Compiled ${template}/${variant}: ${Math.round(performance.now() - start)} ms`,
      )
    }
  }
  await writeFile(
    resolve(outputDir, 'fixtures.json'),
    JSON.stringify(fixtures, null, 2) + '\n',
  )
}

async function run() {
  const fixtures = await readJson<Array<Fixture>>(
    resolve(outputDir, 'fixtures.json'),
  )
  const conn = new V5SerialConnection(
    createBunAdapter({ path: process.env.BRAIN_PORT ?? '/dev/ttyACM0' }),
  )
  const created: Array<{ filename: string; vendor: FileVendor }> = []
  const records: Array<Record<string, unknown>> = []
  let userPort: AdapterSerialPort | undefined
  let userReader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let userTask: Promise<void> | undefined
  let terminal = ''
  let cleanupPassed = true
  conn.on('warning', (warning) => console.warn('Serial warning', warning))
  let originalFiles: string | undefined
  const signature = (
    files: Array<{
      filename: string
      size: number
      crc32: number
      loadAddress: number
    }>,
  ) =>
    JSON.stringify(
      files
        .map(({ filename, size, crc32, loadAddress }) => ({
          filename,
          size,
          crc32,
          loadAddress,
        }))
        .sort((a, b) => a.filename.localeCompare(b.filename)),
    )
  const directory = async (vendor: FileVendor) => {
    const count = await conn.writeDataAsync(
      new GetDirectoryFileCountH2DPacket(vendor),
    )
    if (!(count instanceof GetDirectoryFileCountReplyD2HPacket))
      throw new Error('Could not inspect Brain files')
    const files = []
    for (let index = 0; index < count.count; index++) {
      const entry = await conn.writeDataAsync(
        new GetDirectoryEntryH2DPacket(index),
      )
      if (!(entry instanceof GetDirectoryEntryReplyD2HPacket) || !entry.file)
        throw new Error('Could not inspect Brain entry')
      files.push(entry.file)
    }
    return files
  }
  const remember = (filename: string, vendor: FileVendor) => {
    if (
      !created.some(
        (file) => file.filename === filename && file.vendor === vendor,
      )
    )
      created.push({ filename, vendor })
  }
  try {
    if ((await conn.open(0, true)) !== true)
      throw new Error('Could not open Brain')
    userPort = await createBunAdapter({
      path: process.env.BRAIN_USER_PORT ?? '/dev/ttyACM1',
      signals: { dataTerminalReady: true, requestToSend: true },
    }).requestPort()
    await userPort.open({ baudRate: 115200 })
    userReader = userPort.readable!.getReader()
    const decoder = new TextDecoder()
    userTask = (async () => {
      for (;;) {
        const { value, done } = await userReader.read()
        if (done) break
        terminal = (terminal + decoder.decode(value, { stream: true })).slice(
          -8192,
        )
      }
    })()
    const firmware = (
      await conn.getSystemStatus()
    )?.systemVersion.toUserString()
    const original = await directory(FileVendor.USER)
    const libraries = await directory(FileVendor.DEV2)
    originalFiles = signature(original) + signature(libraries)
    if (original.some((file) => /^slot_8\./.test(file.filename)))
      throw new Error(
        'Slot 8 is occupied; select another free slot before running',
      )
    const libraryName = 'v5x_hw_test_cold'
    if (libraries.some((file) => file.filename === libraryName))
      throw new Error('Test library name already exists')
    for (const fixture of fixtures) {
      if (
        process.env.BRAIN_TEMPLATES &&
        !process.env.BRAIN_TEMPLATES.split(',').includes(fixture.template)
      )
        continue
      if (
        process.env.BRAIN_VARIANTS &&
        !process.env.BRAIN_VARIANTS.split(',').includes(fixture.variant)
      )
        continue
      const hot = fixture.artifacts.find(
        (artifact) => !artifact.path.includes('cold.'),
      )!
      const cold = fixture.artifacts.find((artifact) =>
        artifact.path.includes('cold.'),
      )
      const hotBytes = new Uint8Array(
        await readFile(resolve(outputDir, hot.file)),
      )
      const coldBytes = cold
        ? new Uint8Array(await readFile(resolve(outputDir, cold.file)))
        : undefined
      const ini = new ProgramIniConfig()
      ini.baseName = 'slot_8'
      ini.program.slot = 7
      ini.program.name = `v5x ${fixture.template} ${fixture.variant}`
      ini.project.ide = cold ? 'PROS' : 'VEXcode'
      ini.libraryName = libraryName
      ini.autorun = true
      ini.after = FileExitAction.EXIT_RUN
      ini.setProgramDate(new Date())
      remember('slot_8.ini', FileVendor.USER)
      remember('slot_8.bin', FileVendor.USER)
      if (cold) remember(libraryName, FileVendor.DEV2)
      const scenarios =
        fixture.variant === 'optimized' && cold
          ? ['missing', 'matching', 'mismatched']
          : ['upload']
      for (const scenario of scenarios) {
        if (scenario === 'missing')
          await conn.removeFile({
            filename: libraryName,
            vendor: FileVendor.DEV2,
          })
        if (scenario === 'mismatched') {
          await conn.stopProgram()
          if (
            !(await conn.uploadFileToDevice({
              filename: libraryName,
              vendor: FileVendor.DEV2,
              buf: new Uint8Array([1, 2, 3, 4]),
              downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
              loadAddress: ini.libraryAddress,
              autoRun: false,
            }))
          )
            throw new Error('Could not create isolated mismatched library')
        }
        await conn.stopProgram()
        await Bun.sleep(100)
        terminal = ''
        const progress: Array<{ state: string; bytes: number }> = []
        const start = performance.now()
        const ok = await conn.uploadProgramToDevice(
          ini,
          hotBytes,
          coldBytes,
          (state, current, total) => {
            if (current === total) progress.push({ state, bytes: total })
          },
        )
        const uploadMs = performance.now() - start
        if (!ok)
          throw new Error(
            `Upload failed: ${fixture.template}/${fixture.variant}/${scenario}`,
          )
        const marker = `V5X_HW_OK ${fixture.template} ${fixture.variant} value=30`
        const deadline = Date.now() + 1500
        while (!terminal.includes(marker) && Date.now() < deadline)
          await Bun.sleep(100)
        const screen = await conn.captureScreen()
        let screenText = ''
        const screenFile = `${fixture.template}-${fixture.variant}-${scenario}.png`
        if (screen) {
          const ppm = resolve(outputDir, screenFile + '.ppm')
          await writeFile(
            ppm,
            Buffer.concat([
              Buffer.from('P6\n480 272\n255\n'),
              Buffer.from(screen),
            ]),
          )
          const convert = Bun.spawn(
            [
              'convert',
              ppm,
              '-crop',
              '480x232+0+40',
              '-negate',
              '-resize',
              '300%',
              resolve(outputDir, screenFile),
            ],
            { stdout: 'ignore', stderr: 'pipe' },
          )
          if ((await convert.exited) !== 0)
            throw new Error(await new Response(convert.stderr).text())
          const ocr = Bun.spawn(
            [
              'tesseract',
              resolve(outputDir, screenFile),
              'stdout',
              '--psm',
              '6',
            ],
            { stdout: 'pipe', stderr: 'ignore' },
          )
          screenText = await new Response(ocr.stdout).text()
          if ((await ocr.exited) !== 0)
            throw new Error('Brain screen OCR failed')
        }
        const passed =
          terminal.includes(marker) ||
          (screenText.includes(fixture.template) &&
            screenText.includes(fixture.variant) &&
            /value\s*=\s*30\b/.test(screenText))
        const meta = /meta\s*=\s*(\d+)/.exec(terminal + '\n' + screenText)
        const metadataFresh =
          !cold ||
          Boolean(
            meta &&
            Math.abs(Number(meta[1]) * 1000 - fixture.compiledAt) < 60000,
          )
        const verifyStored = async (
          filename: string,
          vendor: FileVendor,
          loadAddress: number,
          bytes: Uint8Array,
        ) => {
          // Use the same deterministic gzip representation as production upload.
          const compressed = Bun.spawnSync({
            cmd: [
              'python3',
              '-c',
              "import sys,gzip,io\nraw=sys.stdin.buffer.read()\nbuf=io.BytesIO()\nwith gzip.GzipFile(fileobj=buf,mode='wb',mtime=0) as f:\n    f.write(raw)\nsys.stdout.buffer.write(buf.getvalue())",
            ],
            stdin: bytes,
          })
          if (!compressed.success)
            throw new Error('Could not reproduce upload gzip')
          const expected = compressed.stdout
          const entry = (await directory(vendor)).find(
            (file) => file.filename === filename,
          )
          const checksumPassed =
            entry?.size === expected.byteLength &&
            entry.crc32 ===
              PacketEncoder.getInstance().crcgen.crc32(expected, 0)
          // VEXos 1.1.5 requires aligned addresses/sizes and rejects reads past EOF.
          // Verify all readable bytes plus the Brain's CRC for the complete file.
          const readableSize = expected.byteLength & ~3
          console.log(
            `Readback ${filename}: ${readableSize}/${expected.byteLength} bytes`,
          )
          const stored = await conn.downloadFileToHost(
            {
              filename,
              vendor,
              loadAddress,
              size: readableSize,
            },
            FileDownloadTarget.FILE_TARGET_QSPI,
            (current, total) => {
              if (current === total)
                console.log(`Readback complete ${filename}: ${current}`)
            },
          )
          return (
            checksumPassed &&
            Buffer.from(stored).equals(
              Buffer.from(expected.subarray(0, readableSize)),
            )
          )
        }
        const readBackPassed = await verifyStored(
          'slot_8.bin',
          FileVendor.USER,
          cold ? ini.programAddress : 0x03800000,
          hotBytes,
        )
        let coldReadBackPassed = true
        if (
          coldBytes &&
          (scenario === 'missing' || scenario === 'mismatched')
        ) {
          coldReadBackPassed = await verifyStored(
            libraryName,
            FileVendor.DEV2,
            ini.libraryAddress,
            coldBytes,
          )
        }
        const coldState = progress.find((event) =>
          event.state.startsWith('COLD'),
        )?.state
        const reusePassed =
          scenario === 'matching'
            ? coldState === 'COLD (cached)'
            : scenario === 'missing' || scenario === 'mismatched'
              ? coldState === 'COLD'
              : true
        const record = {
          template: fixture.template,
          variant: fixture.variant,
          scenario,
          firmware,
          uploadMs,
          runtimeMs: performance.now() - start - uploadMs,
          artifactBytes: hotBytes.length + (coldBytes?.length ?? 0),
          progress,
          passed,
          metadataFresh,
          reusePassed,
          terminal,
          screenText,
          screenFile,
          readBackPassed,
          readBackMethod:
            'aligned compressed bytes and full-file Brain size/CRC32',
          coldReadBackPassed,
          commitSha: fixture.commitSha,
        }
        records.push(record)
        console.log(JSON.stringify(record))
        await writeFile(
          resolve(outputDir, 'results.json'),
          JSON.stringify(
            {
              date: new Date().toISOString(),
              transport:
                'USB, repository Bun adapter and production uploadProgramToDevice',
              slot: 8,
              records,
            },
            null,
            2,
          ) + '\n',
        )
        if (
          !passed ||
          !metadataFresh ||
          !reusePassed ||
          !readBackPassed ||
          !coldReadBackPassed
        )
          throw new Error(
            `Runtime acceptance failed: ${fixture.template}/${fixture.variant}/${scenario}`,
          )
        await conn.stopProgram()
      }
    }
  } finally {
    await userReader?.cancel()
    await userTask
    userReader?.releaseLock()
    await userPort?.close()
    if (conn.isConnected) {
      await conn.stopProgram()
      for (const file of created) {
        const removed = await conn.removeFile(file)
        console.log(`Cleanup ${file.filename}: ${removed}`)
      }
    }
    cleanupPassed = true
    if (conn.isConnected && originalFiles !== undefined) {
      cleanupPassed =
        originalFiles ===
        signature(await directory(FileVendor.USER)) +
          signature(await directory(FileVendor.DEV2))
      console.log(`Original Brain files preserved: ${cleanupPassed}`)
    }
    await writeFile(
      resolve(outputDir, 'results.json'),
      JSON.stringify(
        {
          date: new Date().toISOString(),
          transport:
            'USB, production uploadProgramToDevice, dedicated CDC user port and framebuffer',
          slot: 8,
          records,
          cleanupPassed,
        },
        null,
        2,
      ) + '\n',
    )
    await conn.close()
  }
  if (!cleanupPassed)
    throw new Error('Brain file inventory changed unexpectedly after cleanup')
}

if (process.argv.includes('--prepare')) await prepare()
if (process.argv.includes('--upload')) await run()
if (!process.argv.includes('--prepare') && !process.argv.includes('--upload'))
  console.log(
    'Use --prepare to compile fixtures, then --upload to reserve free slot 8, upload, run and clean up.',
  )
