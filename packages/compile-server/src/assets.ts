import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { decompressBuildBytes } from "@v5x/compiler/build-assets"
import {
  decodeBuildArchive,
  isIndexedBuildArchive,
} from "@v5x/compiler/build-archive"
import type { BuildAsset } from "@v5x/compiler/build-assets"
import type { BuildBundleFile } from "@v5x/compiler/build-archive"

export function assetLoader(base: string, directory: string) {
  const origin = new URL(base)
  const url = (path: string) => {
    const resolved = new URL(path, origin)
    if (
      resolved.origin !== origin.origin ||
      !/^\/(compiler|language)\//.test(resolved.pathname)
    )
      throw new Error("SDK asset must come from the configured asset server")
    return resolved.href
  }
  const manifest = async <T>(path: string): Promise<T> => {
    const response = await fetch(url(path), {
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok)
      throw new Error(`Could not load ${path}: ${response.status}`)
    return (await response.json()) as T
  }
  const load = async (asset: BuildAsset) => {
    if (
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes <= 0 ||
      asset.bytes > 256 * 1024 * 1024
    )
      throw new Error("Invalid SDK asset metadata")
    const path = join(directory, asset.sha256)
    const valid = (bytes: Uint8Array) =>
      bytes.length === asset.bytes &&
      Bun.CryptoHasher.hash("sha256", bytes, "hex") === asset.sha256
    try {
      const cached = new Uint8Array(await readFile(path))
      if (valid(cached)) return cached
    } catch {
      /* Download missing or damaged cache entries. */
    }
    const address = url(asset.url)
    let response: Response | undefined
    if (asset.transportCompression === "gzip")
      response = await fetch(address + ".gz", {
        signal: AbortSignal.timeout(120_000),
      }).catch(() => undefined)
    if (!response?.ok)
      response = await fetch(address, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok)
      throw new Error(`Could not load ${asset.url}: ${response.status}`)
    let bytes = new Uint8Array(await response.arrayBuffer())
    if (
      asset.transportCompression === "gzip" &&
      bytes[0] === 0x1f &&
      bytes[1] === 0x8b
    )
      bytes = new Uint8Array(await decompressBuildBytes(bytes, asset.bytes))
    if (!valid(bytes)) throw new Error(`SDK checksum mismatch: ${asset.url}`)
    await mkdir(directory, { recursive: true })
    const temporary = path + "." + crypto.randomUUID()
    await writeFile(temporary, bytes)
    await rename(temporary, path)
    return bytes
  }
  const bundle = async (
    asset: BuildAsset,
    binary: boolean
  ): Promise<Array<BuildBundleFile>> => {
    const bytes = await decompressBuildBytes(await load(asset))
    if (isIndexedBuildArchive(bytes)) return decodeBuildArchive(bytes)
    if (asset.format === "indexed-v1")
      throw new Error("Invalid indexed SDK bundle")
    const value = JSON.parse(new TextDecoder().decode(bytes))
    if (
      !value.files ||
      typeof value.files !== "object" ||
      Array.isArray(value.files) ||
      Object.keys(value.files).length > 20000
    )
      throw new Error("Invalid SDK bundle")
    return Object.entries(value.files).map(([path, contents]) => {
      if (
        !/^\/(sdk|toolchain|workspace)\//.test(path) ||
        path.includes("\0") ||
        path
          .split("/")
          .slice(1)
          .some((part) => !part || part === "." || part === "..") ||
        typeof contents !== "string"
      )
        throw new Error("Invalid SDK file")
      return [
        path,
        binary ? new Uint8Array(Buffer.from(contents, "base64")) : contents,
      ]
    })
  }
  const decode = async (asset: BuildAsset) => {
    const bytes = await load(asset)
    return asset.compression === "gzip" ? decompressBuildBytes(bytes) : bytes
  }
  return { manifest, load, bundle, decode }
}
