import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"

const root = resolve(import.meta.dir, "../apps/code")
const source = resolve(root, "node_modules/@clangd-wasm/core/dist")
const destination = resolve(root, "public/language/clangd-15.0.7")
await mkdir(destination, { recursive: true })
const files = ["clangd.js", "clangd.worker.js", "clangd.wasm"]
const hashes: Record<string, string> = {}
for (const file of files) {
  await copyFile(resolve(source, file), resolve(destination, file))
  hashes[file] = createHash("sha256")
    .update(await readFile(resolve(destination, file)))
    .digest("hex")
}
await copyFile(resolve(source, "../LICENSE"), resolve(destination, "LICENSE"))
await writeFile(
  resolve(destination, "manifest.json"),
  JSON.stringify({ version: "15.0.7", files: hashes }, null, 2)
)
console.log(
  `Prepared local clangd assets in ${dirname(resolve(destination, files[0]))}`
)
