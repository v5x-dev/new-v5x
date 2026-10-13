export type BuildBundleFile = readonly [string, string | Uint8Array, string?]
const magic = new TextEncoder().encode('V5XSDK01')
const maximumBytes = 256 * 1024 * 1024

export function isIndexedBuildArchive(bytes: Uint8Array) {
  return magic.every((byte, index) => bytes[index] === byte)
}

/** Index metadata is small; payloads remain views into the verified owned archive. */
export function decodeBuildArchive(bytes: Uint8Array): Array<BuildBundleFile> {
  if (
    bytes.length < 12 ||
    bytes.length > maximumBytes ||
    !isIndexedBuildArchive(bytes)
  )
    throw new Error('Invalid build archive header')
  const indexLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(8, true)
  if (indexLength > 8 * 1024 * 1024 || indexLength > bytes.length - 12)
    throw new Error('Invalid build archive index size')
  const entries: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(12, 12 + indexLength),
    ),
  )
  if (!Array.isArray(entries) || entries.length > 20000)
    throw new Error('Invalid build archive index')
  const payload = bytes.subarray(12 + indexLength)
  const paths = new Set<string>()
  let end = 0
  const files = entries.map((entry): BuildBundleFile => {
    if (!Array.isArray(entry) || entry.length !== 4)
      throw new Error('Invalid build archive entry')
    const [path, offset, length, digest] = entry
    if (
      typeof path !== 'string' ||
      path.length > 4096 ||
      !/^\/(sdk|toolchain|workspace)\//.test(path) ||
      path.includes('\0') ||
      path
        .split('/')
        .slice(1)
        .some((part) => !part || part === '.' || part === '..') ||
      paths.has(path) ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset !== end ||
      length < 0 ||
      length > payload.length - offset ||
      typeof digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(digest)
    )
      throw new Error('Invalid build archive range or path')
    paths.add(path)
    end = offset + length
    return [path, payload.subarray(offset, end), digest]
  })
  if (end !== payload.length) throw new Error('Unindexed build archive bytes')
  return files
}

export function encodeBuildArchive(
  files: Array<readonly [string, Uint8Array, string]>,
) {
  let offset = 0
  const index = new TextEncoder().encode(
    JSON.stringify(
      files.map(([path, bytes, digest]) => {
        const entry = [path, offset, bytes.length, digest]
        offset += bytes.length
        return entry
      }),
    ),
  )
  const archive = new Uint8Array(12 + index.length + offset)
  archive.set(magic)
  new DataView(archive.buffer).setUint32(8, index.length, true)
  archive.set(index, 12)
  offset = 12 + index.length
  for (const [, bytes] of files) {
    archive.set(bytes, offset)
    offset += bytes.length
  }
  decodeBuildArchive(archive)
  return archive
}
