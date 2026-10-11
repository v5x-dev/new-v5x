import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Resolve logical package names through the release manifest.
export async function compilerAssetLoader(stock = false) {
  const directory = resolve(
    import.meta.dir,
    '../public/compiler/llvm-21.11.0-alpha.1',
  )
  const manifest = JSON.parse(
    await readFile(resolve(directory, 'manifest.json'), 'utf8'),
  )
  return (name: string) =>
    readFile(
      resolve(directory, stock ? name : (manifest.files[name]?.file ?? name)),
    )
}
