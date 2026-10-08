import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import {
  decodeBuildArchive,
  isIndexedBuildArchive,
} from '../src/lib/ide/build-archive'
import type { BuildBundleFile } from '../src/lib/ide/build-archive'

export async function readSdkBundle(
  filename: string,
  binary: boolean,
): Promise<Array<BuildBundleFile>> {
  const bytes = new Uint8Array(gunzipSync(await readFile(filename)))
  if (isIndexedBuildArchive(bytes)) return decodeBuildArchive(bytes)
  const bundle = JSON.parse(new TextDecoder().decode(bytes))
  return Object.entries(bundle.files).map(([path, contents]) => [
    path,
    binary
      ? new Uint8Array(Buffer.from(contents as string, 'base64'))
      : (contents as string),
  ])
}
