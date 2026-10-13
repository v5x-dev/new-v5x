import { createHash } from "node:crypto"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const output = resolve(root, "apps/brain/public/wasm")
const manifestPath = resolve(output, "rust-artifacts.json")
const inputs = [
  "emulator/rust-toolchain.toml",
  "emulator/Cargo.toml",
  "emulator/Cargo.lock",
  "emulator/wasm-host",
  "emulator/protocol",
  "emulator/display",
  "emulator/kernel",
]
const artifacts = [
  "kernel.elf",
  "vex_v5_wasm_host.js",
  "vex_v5_wasm_host.d.ts",
  "vex_v5_wasm_host_bg.wasm",
  "vex_v5_wasm_host_bg.wasm.d.ts",
]

async function sourceFiles(path) {
  const entries = await readdir(path, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (["target", ".git"].includes(entry.name)) continue
    const child = resolve(path, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(child)))
    else if (entry.isFile()) files.push(child)
  }
  return files
}

export async function rustArtifactManifest() {
  const files = []
  for (const input of inputs) {
    const path = resolve(root, input)
    files.push(
      ...(input.endsWith(".toml") || input.endsWith(".lock")
        ? [path]
        : await sourceFiles(path))
    )
  }
  const hash = createHash("sha256")
  for (const path of files.sort()) {
    hash
      .update(relative(root, path))
      .update("\0")
      .update(await readFile(path))
      .update("\0")
  }
  const hashes = {}
  for (const artifact of artifacts) {
    hashes[artifact] = createHash("sha256")
      .update(await readFile(resolve(output, artifact)))
      .digest("hex")
  }
  return { version: 1, sourceHash: hash.digest("hex"), artifacts: hashes }
}

export async function verifyRustArtifacts() {
  const expected = JSON.parse(await readFile(manifestPath, "utf8"))
  const actual = await rustArtifactManifest()
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(
      "Brain Rust sources or artifacts changed. Run bun run --cwd apps/brain wasm:build:rust before building."
    )
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes("--write")) {
    await writeFile(
      manifestPath,
      `${JSON.stringify(await rustArtifactManifest(), null, 2)}\n`
    )
  } else {
    await verifyRustArtifacts()
  }
}
