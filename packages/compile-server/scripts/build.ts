import { cp, mkdir, rm } from "node:fs/promises"

await rm(new URL("../dist/", import.meta.url), { recursive: true, force: true })
const result = await Bun.build({
  entrypoints: ["./src/cli.ts", "./src/compiler.worker.ts"],
  target: "bun",
  outdir: "./dist",
})
if (!result.success)
  throw new AggregateError(result.logs, "Compilation server bundling failed")
const licenses = new URL(
  "../dist/third-party/microbit-clang-wasm/",
  import.meta.url
)
await mkdir(licenses, { recursive: true })
for (const name of ["LICENSE.txt", "LICENSES"])
  await cp(
    new URL("../node_modules/microbit-clang-wasm/" + name, import.meta.url),
    new URL(name, licenses),
    { recursive: true }
  )
console.log(
  `Built compilation server and worker with third-party license notices.`
)
