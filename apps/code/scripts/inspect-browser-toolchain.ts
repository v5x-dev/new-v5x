import { compilerAssetLoader } from './compiler-asset-loader'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createSession, setAssetLoader } from 'microbit-clang-wasm'

const loadCompiler = await compilerAssetLoader()
setAssetLoader(loadCompiler)
const session = createSession()
let targets = ''
const code = await session.run(['clang', '--print-targets'], {
  stdout: (bytes) => {
    if (bytes) targets += new TextDecoder().decode(bytes)
  },
})
if (code) throw new Error('Target inventory failed')
const modules = []
for (const name of [
  'llvm.core.wasm',
  'llvm.core2.wasm',
  'llvm.core3.wasm',
  'llvm.core4.wasm',
]) {
  const bytes = await loadCompiler(name)
  const start = performance.now()
  const module = await WebAssembly.compile(bytes)
  modules.push({
    name,
    bytes: bytes.length,
    compileMs: performance.now() - start,
    imports: WebAssembly.Module.imports(module),
    exports: WebAssembly.Module.exports(module),
  })
}
const output = resolve(
  import.meta.dir,
  '../../../.build/browser-performance/toolchain-audit.json',
)
await mkdir(resolve(output, '..'), { recursive: true })
await writeFile(
  output,
  JSON.stringify(
    {
      compiler: '21.11.0-alpha.1',
      llvmCommit: '0bac08d50952133963671eeeb8c3e67695a32f49',
      host: 'Bun tooling, not browser performance',
      targets,
      modules,
      loader:
        'Pinned loader already uses compileStreaming with WASM MIME, caches module/resource promises per worker, and instantiates commands with an independent Environment. All four component modules are required by generated imports.',
      decision:
        'Keep the pinned compiler. It already supports only ARM/Thumb targets. Removing component adapter modules breaks its generated imports. Standard frontend plans use driver-generated commands with exact matching and original-compiler equivalence checks.',
    },
    null,
    2,
  ) + '\n',
)
console.log(output)
