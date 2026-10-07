import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { promisify } from "node:util"
import { brotliCompress, constants, gzip } from "node:zlib"

const compressBrotli = promisify(brotliCompress)
const compressGzip = promisify(gzip)

/** Nitro negotiates these siblings and browsers decode them before hashing. */
export async function prepareCompressedAsset(path: string) {
  const bytes = await readFile(path)
  const signature = createHash("sha256")
    .update("brotli6-gzip9-v1")
    .update(bytes)
    .digest("hex")
  const metadataPath = path + ".compression.json"
  try {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"))
    if (metadata.signature === signature) {
      const [br, gz] = await Promise.all([
        readFile(path + ".br"),
        readFile(path + ".gz"),
      ])
      if (br.length === metadata.br && gz.length === metadata.gz) return
    }
  } catch {
    // Missing or outdated companions are regenerated during preparation.
  }

  const [br, gz] = await Promise.all([
    compressBrotli(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
    }),
    compressGzip(bytes, { level: 9 }),
  ])
  await Promise.all([writeFile(path + ".br", br), writeFile(path + ".gz", gz)])
  await writeFile(
    metadataPath,
    JSON.stringify({ signature, br: br.length, gz: gz.length }) + "\n"
  )
  console.log(`Compressed ${path}: ${bytes.length} → ${br.length} Brotli bytes`)
}
