import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

// Install the verified Binaryen release described in compiler/README.md first.
const optimizer = process.env.WASM_OPT
if (!optimizer) throw new Error('Set WASM_OPT to Binaryen version 133 wasm-opt')
const version = await Bun.$`${optimizer} --version`.text()
if (!/version 133\b/.test(version))
  throw new Error('Binaryen version 133 is required')
const directory = resolve(import.meta.dir, '../compiler')
const metadataPath = resolve(
  directory,
  'llvm-21.11.0-alpha.1-binaryen-133.json',
)
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
const input = resolve(
  import.meta.dir,
  '../node_modules/microbit-clang-wasm/gen/llvm.core.wasm',
)
const source = await readFile(input)
const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')
if (
  digest(source) !== metadata.sourceSha256 ||
  source.length !== metadata.sourceBytes
)
  throw new Error('Pinned compiler source changed')
const temporary = resolve(
  import.meta.dir,
  '../../../.build/compiler-optimization',
)
await mkdir(temporary, { recursive: true })
const output = resolve(temporary, 'llvm.core.wasm')
const compilerProcess = Bun.spawn(
  [optimizer, input, ...metadata.optimizer.flags, '-o', output],
  {
    env: { ...process.env, BINARYEN_CORES: '4' },
    stdout: 'inherit',
    stderr: 'inherit',
  },
)
if (await compilerProcess.exited)
  throw new Error('Compiler optimization failed')
const bytes = await readFile(output)
// Python's zlib packaging matches the reviewed portable gzip input.
const compressedPath = resolve(temporary, 'llvm.core.wasm.gz')
const pack = Bun.spawn([
  'python3',
  '-c',
  'import gzip,pathlib,sys; pathlib.Path(sys.argv[2]).write_bytes(gzip.compress(pathlib.Path(sys.argv[1]).read_bytes(), compresslevel=9, mtime=0))',
  output,
  compressedPath,
])
if (await pack.exited) throw new Error('Compiler compression failed')
const compressed = await readFile(compressedPath)
// Reproduction must produce the same content-addressed release input.
if (
  digest(bytes) !== metadata.sha256 ||
  digest(compressed) !== metadata.compressedSha256
)
  throw new Error('Optimizer output differs from the reviewed release input')
await writeFile(
  resolve(directory, 'llvm-21.11.0-alpha.1-binaryen-133.wasm.gz'),
  compressed,
)
console.log(
  `Reproduced optimized compiler: ${source.length} -> ${bytes.length} bytes`,
)
