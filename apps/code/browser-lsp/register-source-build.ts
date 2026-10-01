import { createHash } from 'node:crypto'
import manifest from './artifacts.json'
const root = `${import.meta.dir}/../public/lsp/v1`
for (const name of ['clangd.js', 'clangd.wasm'] as const) {
  const bytes = await Bun.file(`${root}/${name}`).arrayBuffer()
  manifest[name].sha256 = createHash('sha256')
    .update(new Uint8Array(bytes))
    .digest('hex')
}
await Bun.write(
  `${import.meta.dir}/artifacts.json`,
  JSON.stringify(manifest, null, 2) + '\n',
)
console.log(
  'Registered locally built clangd artifacts. Publish these assets with the matching manifest.',
)
