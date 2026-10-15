import { mkdir, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const roots = ["workspace", "sdk", "toolchain"] as const
export type RootName = (typeof roots)[number]

export function validateWorkspaceAbsolute(value: string) {
  const root = "/workspace"
  if (
    !(value === root || value.startsWith(root + "/")) ||
    !isVirtualRootOrPath(value)
  )
    throw new Error("Compilation paths must be inside /workspace")
  return value
}

export function validateVirtualAbsolute(value: string) {
  if (!isVirtualPath(value))
    throw new Error(
      "Compiler paths must stay inside /workspace, /sdk, or /toolchain"
    )
}

export function isVirtualPath(
  value: string
): value is `/${RootName}/${string}` {
  return (
    roots.some((root) => value.startsWith(`/${root}/`)) &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !value
      .slice(1)
      .split("/")
      .some((part) => !part || part === "." || part === "..")
  )
}

export function isVirtualRootOrPath(value: string) {
  return roots.some((root) => value === `/${root}`) || isVirtualPath(value)
}

export function isSdkVirtualPath(value: string) {
  return (
    (/^\/(sdk|toolchain)\//.test(value) ||
      value.startsWith("/workspace/include/")) &&
    isVirtualPath(value)
  )
}

export function validProjectPath(value: string) {
  return (
    !!value &&
    value.length <= 4096 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.split("/").some((part) => !part || part === "." || part === "..")
  )
}

export function physicalPath(root: string, virtualPath: string) {
  if (!isVirtualRootOrPath(virtualPath))
    throw new Error("Invalid virtual filesystem path")
  const physical = resolve(root, virtualPath.slice(1))
  const relativePath = relative(root, physical)
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  )
    throw new Error("Path escaped the language session")
  return physical
}

export async function writeVirtualFile(
  root: string,
  virtualPath: string,
  contents: string | Uint8Array
) {
  const filename = physicalPath(root, virtualPath)
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 })
  await writeFile(filename, contents, { mode: 0o600 })
}

export function byteLengthOfFiles(files: Map<string, string>) {
  let total = 0
  for (const [path, contents] of files)
    total += Buffer.byteLength(path) + Buffer.byteLength(contents)
  return total
}

export function virtualProjectPathFromUri(uri: string) {
  const url = new URL(uri)
  if (url.protocol !== "file:" || url.host || url.search || url.hash)
    throw new Error("Invalid workspace URI")
  const path = decodeURIComponent(url.pathname)
  if (!path.startsWith("/workspace/"))
    throw new Error("Document URI must be inside /workspace")
  return path.slice("/workspace/".length)
}

export function mapVirtualUriToPhysical(uri: string, root: string) {
  const url = new URL(uri)
  if (url.protocol !== "file:") return uri
  if (url.host || url.search || url.hash)
    throw new Error("LSP file URI must be a local mounted path")
  const virtualPath = decodeURIComponent(url.pathname)
  if (
    virtualPath === "/workspace" ||
    virtualPath === "/sdk" ||
    virtualPath === "/toolchain"
  )
    return pathToFileURL(join(root, virtualPath.slice(1))).href
  if (!isVirtualPath(virtualPath))
    throw new Error("LSP file URI is outside the mounted workspace and SDK")
  return pathToFileURL(physicalPath(root, virtualPath)).href
}

export function mapPhysicalUriToVirtual(uri: string, root: string) {
  const url = new URL(uri)
  if (url.protocol !== "file:") return uri
  if (url.host || url.search || url.hash) return undefined
  let physical: string
  try {
    physical = fileURLToPath(url)
  } catch {
    return undefined
  }
  const rel = relative(root, physical)
  if (
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    !isVirtualRootOrPath(`/${rel.split(sep).join("/")}`)
  )
    return undefined
  return pathToFileURL(`/` + rel.split(sep).join("/")).href
}

export function remapUris<T>(
  value: T,
  mapUri: (uri: string) => string | undefined
): T | undefined {
  if (typeof value === "string")
    return (value.startsWith("file:") ? mapUri(value) : value) as T | undefined
  if (Array.isArray(value))
    return value
      .map((item) => remapUris(item, mapUri))
      .filter((item) => item !== undefined) as T
  if (!isRecord(value)) return value
  const mapped: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const mappedKey = key.startsWith("file:") ? mapUri(key) : key
    if (mappedKey === undefined) continue
    const mappedItem = remapUris(item, mapUri)
    if (mappedItem === undefined) {
      if (key === "result") mapped[mappedKey] = null
      if (["uri", "targetUri", "oldUri", "newUri"].includes(key))
        return undefined
      continue
    }
    mapped[mappedKey] = mappedItem
  }
  return mapped as T
}

export function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
