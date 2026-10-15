import {
  MAX_SOURCE_BYTES,
  validateSourceFiles,
  type SourceFile,
} from './source-files'

export function importDraftRecovery(text: string): SourceFile[] {
  if (new TextEncoder().encode(text).byteLength > 16 * 1024 * 1024)
    throw new Error('Recovery file exceeds the 16 MiB limit')
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid draft recovery file')
  const record = value as Record<string, unknown>
  if (
    record.version !== 1 ||
    !record.files ||
    typeof record.files !== 'object' ||
    Array.isArray(record.files)
  )
    throw new Error('Unsupported draft recovery format')
  const files: SourceFile[] = []
  let bytes = 0
  for (const [path, contents] of Object.entries(record.files)) {
    if (typeof contents !== 'string')
      throw new Error('Recovery sources must be text')
    bytes += new TextEncoder().encode(contents).byteLength
    if (bytes > MAX_SOURCE_BYTES)
      throw new Error('Sources exceed the 8 MiB limit')
    files.push({ path, contents })
  }
  return validateSourceFiles(files)
}

// Writes the format read by importDraftRecovery.
export function exportDraftRecovery(files: Record<string, string>) {
  return JSON.stringify({ version: 1, files }, null, 2)
}

export function downloadDraftRecovery(files: Record<string, string>) {
  const blob = new Blob([exportDraftRecovery(files)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'v5x-draft-recovery.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
