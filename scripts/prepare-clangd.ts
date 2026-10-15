import { prepareCompressedAsset } from "./prepare-compressed-assets"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"

const root = resolve(import.meta.dir, "../apps/code")

const version = process.env.CLANGD_WASM_VERSION ?? "15.0.7-small"
const packageName =
  process.env.CLANGD_WASM_PACKAGE ?? "@clangd-wasm/core-small@15.0.7"
const source = resolve(
  root,
  process.env.CLANGD_WASM_DIST ?? "node_modules/@clangd-wasm/core/dist"
)

const destination = resolve(
  root,
  process.env.CLANGD_WASM_OUTPUT ?? `public/language/clangd-${version}`
)

await mkdir(destination, { recursive: true })

const files = ["clangd.js", "clangd.worker.js", "clangd.wasm"]

const hashes: Record<string, string> = {}

for (const file of files) {
  await copyFile(resolve(source, file), resolve(destination, file))

  hashes[file] = createHash("sha256")
    .update(await readFile(resolve(destination, file)))
    .digest("hex")
}

await prepareCompressedAsset(resolve(destination, "clangd.wasm"))

// core-small omits the upstream license from its npm package.
const license = resolve(
  root,
  process.env.CLANGD_WASM_LICENSE ??
    "../../scripts/licenses/clangd-wasm-core-LICENSE"
)
await copyFile(license, resolve(destination, "LICENSE"))

await writeFile(
  resolve(destination, "manifest.json"),
  JSON.stringify({ version, package: packageName, files: hashes }, null, 2)
)

console.log(
  `Prepared local clangd assets in ${dirname(resolve(destination, files[0]))}`
)
