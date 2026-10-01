import { readdir, readFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { SdkPack } from '../src/lib/browser-lsp-types'

// Extracted from the same SDK/toolchain image used by program builds.
const source = resolve(Bun.argv[2] ?? 'browser-lsp/.build/sdk')
const output = resolve('public/lsp/v1')
await mkdir(output, { recursive: true })
async function tree(
  root: string,
  destination: string,
): Promise<SdkPack['files']> {
  const files: SdkPack['files'] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    const target = `${destination}/${entry.name}`
    if (entry.isDirectory()) files.push(...(await tree(path, target)))
    else files.push({ path: target, contents: await readFile(path, 'utf8') })
  }
  return files
}
async function pack(
  name: string,
  roots: [string, string][],
  includePaths: string[],
) {
  const files = (
    await Promise.all(roots.map(([root, target]) => tree(root, target)))
  ).flat()
  await Bun.write(
    `${output}/${name}.pack`,
    gzipSync(JSON.stringify({ files, includePaths } satisfies SdkPack), {
      level: 9,
    }),
  )
  console.log(`${name}: ${files.length} header files`)
}
await pack(
  'vexcode',
  [
    [join(source, 'sdk/vexv5/include'), '/sdk/vex/include'],
    [join(source, 'sdk/vexv5/gcc/include'), '/sdk/vex/gcc/include'],
    [join(source, 'sdk/vexv5/clang/8.0.0/include'), '/sdk/vex/clang/include'],
  ],
  [
    '/sdk/vex/include',
    '/sdk/vex/gcc/include/c++/4.9.3',
    '/sdk/vex/gcc/include/c++/4.9.3/arm-none-eabi/armv7-ar/thumb',
    '/sdk/vex/gcc/include',
    '/sdk/vex/clang/include',
  ],
)
await pack(
  'pros',
  [
    [join(source, 'usr/arm-none-eabi/include'), '/sdk/arm/include'],
    [join(source, 'usr/lib/llvm20/lib/clang/20/include'), '/sdk/clang/include'],
    [resolve('browser-lsp/.build/pros/include'), '/sdk/pros/include'],
  ],
  [
    '/sdk/pros/include',
    '/sdk/arm/include/c++/16.1.0',
    '/sdk/arm/include/c++/16.1.0/arm-none-eabi/thumb/v7+fp/softfp',
    '/sdk/arm/include/c++/16.1.0/arm-none-eabi',
    '/sdk/arm/include',
    '/sdk/clang/include',
  ],
)
await pack(
  'ez-template',
  [[resolve('browser-lsp/.build/ez/include'), '/sdk/ez/include']],
  ['/sdk/ez/include'],
)
