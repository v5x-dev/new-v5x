import { createHash } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'

// Pinned upstream LLVM 21.1 / Emscripten 4.0.22 build, with wait-for-stdin patch.
const base = 'https://clangd.guyutongxue.site/wasm/'
import manifest from './artifacts.json'
const assets = {
  'clangd.js': manifest['clangd.js'],
  'clangd.wasm': manifest['clangd.wasm'],
}
const directory = resolve(import.meta.dir, '../public/lsp/v1')
await mkdir(directory, { recursive: true })
for (const [name, artifact] of Object.entries(assets)) {
  const target = Bun.file(`${directory}/${name}`)
  if (await target.exists()) {
    const current = new Uint8Array(await target.arrayBuffer())
    const digest = createHash('sha256').update(current).digest('hex')
    if (digest === artifact.sha256) continue
    if (digest === artifact.source) {
      await Bun.write(
        target,
        name.endsWith('.js') ? adaptJavascript(current) : adaptMemory(current),
      )
      continue
    }
  }

  console.log(`Downloading ${name}`)
  const response = await fetch(`${base}${name}`)
  if (!response.ok) throw new Error(`Could not download ${name}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== artifact.source)
    throw new Error(`Checksum mismatch for ${name}`)
  const adapted = name.endsWith('.js')
    ? adaptJavascript(bytes)
    : adaptMemory(bytes)
  if (createHash('sha256').update(adapted).digest('hex') !== artifact.sha256)
    throw new Error(`Adapted checksum mismatch for ${name}`)
  await Bun.write(target, adapted)
}

function adaptJavascript(bytes: Uint8Array) {
  let source = new TextDecoder().decode(bytes)
  if (source.includes('v5x browser clangd')) return bytes
  const pool = 'Math.max(navigator.hardwareConcurrency,8)'
  if (!source.includes(pool))
    throw new Error('Unknown clangd thread-pool layout')
  source = source.replace(pool, '6')
  // Imported memory may be smaller than the upstream initial allocation.
  source = source.replace(
    'Module["INITIAL_MEMORY"]||2147483648',
    'Module["INITIAL_MEMORY"]||268435456',
  )
  return new TextEncoder().encode(
    `// v5x browser clangd: six pooled threads, 256 MiB initial memory.\n${source}`,
  )
}

// Lower the pinned module's shared-memory import from 2 GiB to 256 MiB.
// Padded LEB128 keeps all section offsets unchanged. Memory grows on demand.
function adaptMemory(bytes: Uint8Array) {
  if (bytes[3171] === 128 && bytes[3172] === 160 && bytes[3173] === 0)
    return bytes
  if (bytes[3171] !== 128 || bytes[3172] !== 128 || bytes[3173] !== 2)
    throw new Error('Unknown clangd shared-memory import')
  bytes.set([128, 160, 0], 3171)
  return bytes
}

// Keep large WASM downloads small on Nitro/static CDNs with precompression.
for (const name of Object.keys(assets)) {
  const bytes = await Bun.file(`${directory}/${name}`).arrayBuffer()
  for (const encoding of ['gz', 'br'] as const) {
    const target = Bun.file(`${directory}/${name}.${encoding}`)
    if (await target.exists()) {
      const [sourceInfo, compressedInfo] = await Promise.all([
        stat(`${directory}/${name}`),
        stat(`${directory}/${name}.${encoding}`),
      ])
      if (compressedInfo.mtimeMs >= sourceInfo.mtimeMs) continue
    }
    const compressed =
      encoding === 'gz'
        ? gzipSync(new Uint8Array(bytes), { level: 9 })
        : brotliCompressSync(new Uint8Array(bytes), {
            params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
          })
    await Bun.write(target, compressed)
  }
}
for (const [name, artifact] of Object.entries(manifest)) {
  if (!name.endsWith('.pack')) continue
  const file = Bun.file(`${directory}/${name}`)
  if (
    !(await file.exists()) ||
    createHash('sha256')
      .update(new Uint8Array(await file.arrayBuffer()))
      .digest('hex') !== artifact.sha256
  )
    throw new Error(
      `Missing or outdated SDK pack: ${name}. Run lsp:pack-sdk and update artifacts.json.`,
    )
}
