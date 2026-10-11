import { prepareCompressedAsset } from "./prepare-compressed-assets"
import { createHash } from "node:crypto"
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { gunzipSync } from "node:zlib"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "../apps/code")
const version = "21.11.0-alpha.1"
const source = resolve(root, "node_modules/microbit-clang-wasm")
const destination = resolve(root, `public/compiler/llvm-${version}`)
await mkdir(destination, { recursive: true })

const files: Record<string, { sha256: string; bytes: number; file?: string }> =
  {}
// Drop Cortex-M4 libraries and libc++. V5 bundles provide the ARM runtime;
// only Clang's builtin headers are needed from the package resource archive.
function compilerResources(archive: Uint8Array) {
  const entries: Array<Uint8Array> = []
  const decoder = new TextDecoder()
  const field = (offset: number, length: number) =>
    decoder.decode(archive.subarray(offset, offset + length)).split("\0")[0]
  let offset = 0
  while (offset + 512 <= archive.length && archive[offset] !== 0) {
    const name = field(offset, 100)
    const prefix = field(offset + 345, 155)
    const path = prefix ? `${prefix}/${name}` : name
    const size = parseInt(field(offset + 124, 12).trim() || "0", 8)
    if (!Number.isFinite(size))
      throw new Error("Invalid compiler resource archive")
    const end = offset + 512 + Math.ceil(size / 512) * 512
    if (end > archive.length)
      throw new Error("Truncated compiler resource archive")
    if (
      path === "lib" ||
      path === "lib/" ||
      path === "lib/clang" ||
      path.startsWith("lib/clang/")
    )
      entries.push(archive.subarray(offset, end))
    offset = end
  }
  if (!entries.length) throw new Error("Clang builtin headers are missing")
  return Buffer.concat([...entries, new Uint8Array(1024)])
}

for (const name of [
  "llvm.core.wasm",
  "llvm.core2.wasm",
  "llvm.core3.wasm",
  "llvm.core4.wasm",
  "llvm-resources.tar",
]) {
  const original = await readFile(resolve(source, "gen", name))
  const bytes =
    name === "llvm-resources.tar" ? compilerResources(original) : original
  await writeFile(resolve(destination, name), bytes)
  if (name.endsWith(".wasm") || name.endsWith(".tar"))
    await prepareCompressedAsset(resolve(destination, name))
  files[name] = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
  }
}

// Preserve the package asset for existing workers and reference verification.
const optimization = JSON.parse(
  await readFile(
    resolve(root, "compiler/llvm-21.11.0-alpha.1-binaryen-133.json"),
    "utf8"
  )
)
const compressed = await readFile(
  resolve(root, "compiler/llvm-21.11.0-alpha.1-binaryen-133.wasm.gz")
)
const optimized = gunzipSync(compressed)
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")
if (
  files["llvm.core.wasm"].sha256 !== optimization.sourceSha256 ||
  compressed.length !== optimization.compressedBytes ||
  digest(compressed) !== optimization.compressedSha256 ||
  optimized.length !== optimization.bytes ||
  digest(optimized) !== optimization.sha256
)
  throw new Error("Optimized compiler provenance does not match its inputs")
const originalCore = { ...files["llvm.core.wasm"], file: "llvm.core.wasm" }
const templateFiles = Object.fromEntries(
  ["vexcode", "pros", "jar-template"].map((template) => [
    template,
    { "llvm.core.wasm": originalCore },
  ])
)
const optimizedFile = `llvm.core-${optimization.sha256.slice(0, 16)}.wasm`
await writeFile(resolve(destination, optimizedFile), optimized)
await prepareCompressedAsset(resolve(destination, optimizedFile))
files["llvm.core.wasm"] = {
  sha256: optimization.sha256,
  bytes: optimization.bytes,
  file: optimizedFile,
}

await copyFile(
  resolve(source, "LICENSE.txt"),
  resolve(destination, "LICENSE.txt")
)
await cp(resolve(source, "LICENSES"), resolve(destination, "LICENSES"), {
  recursive: true,
})
await writeFile(
  resolve(destination, "manifest.json"),
  JSON.stringify({ version, files, templateFiles }, null, 2) + "\n"
)
console.log(`Prepared browser LLVM ${version}`)
