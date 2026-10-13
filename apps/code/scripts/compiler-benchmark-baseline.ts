import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Benchmark a historical compiler implementation without changing the live app. */
export async function compilerBenchmarkBaseline(revision: string) {
  const root = resolve(import.meta.dir, '../../..')
  const git = (args: Array<string>, stdin?: Uint8Array) => {
    const result = Bun.spawnSync(['git', ...args], {
      cwd: root,
      stdin,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (result.exitCode) throw new Error(result.stderr.toString())
    return result.stdout.toString()
  }
  const commit = git(['rev-parse', revision]).trim()
  const directory = resolve(root, '.build/compiler-edits/baselines', commit)
  const ide = resolve(directory, 'ide')
  const runtime = resolve(directory, 'runtime')
  await mkdir(ide, { recursive: true })
  await mkdir(resolve(runtime, 'gen'), { recursive: true })
  for (const path of git([
    'ls-tree',
    '-r',
    '--name-only',
    commit,
    'apps/code/src/lib/ide',
    'packages/compiler/src',
  ])
    .trim()
    .split('\n')) {
    if (!path.endsWith('.ts') || path.endsWith('.test.ts')) continue
    await writeFile(
      resolve(ide, path.split('/').at(-1)!),
      git(['show', `${commit}:${path}`]),
    )
  }
  await mkdir(resolve(runtime, 'lib'), { recursive: true })
  await writeFile(
    resolve(runtime, 'lib/api.d.ts'),
    await readFile(
      new URL('../lib/api.d.ts', import.meta.resolve('microbit-clang-wasm')),
    ),
  )
  const bundle = resolve(runtime, 'gen/bundle.js')
  await writeFile(
    bundle,
    await readFile(new URL(import.meta.resolve('microbit-clang-wasm'))),
  )
  const patch = 'patches/microbit-clang-wasm@21.11.0-alpha.1.patch'
  const destination = `--directory=${relative(root, runtime)}`
  git(['apply', '--reverse', destination, patch])
  git(
    ['apply', destination, '-'],
    Buffer.from(git(['show', `${commit}:${patch}`])),
  )
  return {
    commit,
    toolchain: (await import(
      pathToFileURL(bundle).href
    )) as typeof import('microbit-clang-wasm'),
    compiler: (await import(
      pathToFileURL(resolve(ide, 'browser-build.ts')).href
    )) as typeof import('@v5x/compiler/browser-build'),
    libraries: JSON.parse(
      git(['show', `${commit}:apps/code/public/compiler/sdk-manifest.json`]),
    ),
  }
}
