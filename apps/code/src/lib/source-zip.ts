import { Unzip, UnzipInflate, zipSync } from 'fflate'
import {
  generatedSourcePath,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_FILES,
  validSourcePath,
  validateSourceFiles,
  type SourceFile,
} from './source-files'

function centralDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (
      view.getUint32(end, true) === 0x06054b50 &&
      end + 22 + view.getUint16(end + 20, true) === bytes.length
    )
      break
  }
  if (end < 0 || end < bytes.length - 65557)
    throw new Error('ZIP central directory is missing')
  const count = view.getUint16(end + 10, true)
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    count !== view.getUint16(end + 8, true) ||
    count > 4000
  )
    throw new Error('Unsupported multi-volume or oversized ZIP')
  let cursor = view.getUint32(end + 16, true)
  if (cursor + view.getUint32(end + 12, true) !== end)
    throw new Error('Invalid ZIP directory bounds')
  const entries = new Map<string, { size: number; crc: number }>()
  let total = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error('Invalid ZIP directory entry')
    if (view.getUint16(cursor + 8, true) & 1)
      throw new Error('Encrypted ZIPs are not supported')
    const length = view.getUint16(cursor + 28, true)
    const next =
      cursor +
      46 +
      length +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true)
    if (next > end) throw new Error('Invalid ZIP directory entry')
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(cursor + 46, cursor + 46 + length),
    )
    const size = view.getUint32(cursor + 24, true)
    if (entries.has(name)) throw new Error('ZIP contains duplicate paths')
    if (((view.getUint32(cursor + 38, true) >>> 16) & 0xf000) === 0xa000)
      throw new Error('ZIP symlinks are not supported')
    if (!generatedSourcePath(name)) total += size
    if (total > MAX_SOURCE_BYTES)
      throw new Error('Sources exceed the 8 MiB limit')
    entries.set(name, { size, crc: view.getUint32(cursor + 16, true) })
    cursor = next
  }
  if (cursor !== end) throw new Error('Invalid ZIP directory size')
  return entries
}

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  return value
})
function crc32(bytes: Uint8Array) {
  let value = 0xffffffff
  for (const byte of bytes)
    value = (value >>> 8) ^ crcTable[(value ^ byte) & 255]
  return (value ^ 0xffffffff) >>> 0
}

export function importSourceZip(
  bytes: Uint8Array,
  stripRoot = false,
): SourceFile[] {
  if (bytes.byteLength > 16 * 1024 * 1024)
    throw new Error('ZIP exceeds the 16 MiB compressed limit')
  const directory = centralDirectory(bytes)
  const files: SourceFile[] = []
  const names = new Set<string>()
  let expanded = 0
  let entries = 0
  let pending = 0
  const unzip = new Unzip((file) => {
    entries++
    const metadata = directory.get(file.name)
    if (!metadata)
      throw new Error('ZIP entry is missing from the central directory')
    if (entries > 4000) throw new Error('ZIP contains too many entries')
    const path = file.name.replace(/\/$/, '')
    if (!validSourcePath(path) || names.has(file.name))
      throw new Error('ZIP contains invalid or duplicate paths')
    names.add(file.name)
    if (file.name.endsWith('/') || generatedSourcePath(path)) return
    if (files.length + pending >= MAX_SOURCE_FILES)
      throw new Error('ZIP exceeds the 2000 source file limit')
    if ((file.originalSize ?? 0) > MAX_SOURCE_BYTES)
      throw new Error('Sources exceed the 8 MiB limit')
    pending++
    const chunks: Uint8Array[] = []
    let size = 0
    file.ondata = (error, data, final) => {
      if (error) throw error
      size += data.byteLength
      expanded += data.byteLength
      if (expanded > MAX_SOURCE_BYTES)
        throw new Error('Sources exceed the 8 MiB limit')
      chunks.push(data.slice())
      if (!final) return
      const contents = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        contents.set(chunk, offset)
        offset += chunk.byteLength
      }
      if (size !== metadata.size || crc32(contents) !== metadata.crc)
        throw new Error('ZIP source checksum does not match')
      const text = new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: true,
      }).decode(contents)
      files.push({ path, contents: text })
      pending--
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  // Small compressed chunks bound decompressor output before enforcing the total.
  for (let offset = 0; offset < bytes.byteLength; offset += 1024) {
    unzip.push(
      bytes.subarray(offset, offset + 1024),
      offset + 1024 >= bytes.byteLength,
    )
  }
  if (pending || entries !== directory.size)
    throw new Error('ZIP is incomplete')
  // GitHub-style archives wrap every source in one project folder.
  const root = files[0]?.path.split('/')[0]
  if (
    stripRoot &&
    root &&
    files.every((file) => file.path.startsWith(`${root}/`))
  ) {
    for (const file of files) file.path = file.path.slice(root.length + 1)
  }
  return validateSourceFiles(files)
}

export function exportSourceZip(files: SourceFile[]) {
  validateSourceFiles(files)
  return zipSync(
    Object.fromEntries(
      files.map((file) => [file.path, new TextEncoder().encode(file.contents)]),
    ),
    { level: 6 },
  )
}
