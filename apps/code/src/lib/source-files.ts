export const MAX_SOURCE_FILES = 2000
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024

export interface SourceFile {
  path: string
  contents: string
}

export function validSourcePath(path: string) {
  return (
    !!path &&
    path.length <= 1024 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !/^[A-Za-z]:/.test(path) &&
    !path
      .split('/')
      .some((part) => !part || part === '.' || part === '..' || part === '.git')
  )
}

export function generatedSourcePath(path: string) {
  return (
    path
      .split('/')
      .some((part) =>
        ['build', 'bin', 'node_modules', '.cache'].includes(part),
      ) || /\.(a|o|bin|elf|png|jpg|jpeg|gif|ico|woff2?|zip|pdf)$/i.test(path)
  )
}

export function validateSourceFiles(files: SourceFile[]) {
  if (!files.length || files.length > MAX_SOURCE_FILES)
    throw new Error('Import must contain 1 to 2000 source files')
  const paths = new Set<string>()
  let bytes = 0
  for (const file of files) {
    if (!validSourcePath(file.path))
      throw new Error(`Invalid source path: ${file.path}`)
    if (paths.has(file.path))
      throw new Error(`Duplicate source path: ${file.path}`)
    paths.add(file.path)
    if (file.contents.includes('\0'))
      throw new Error(
        `Binary files are not supported in source imports: ${file.path}`,
      )
    bytes += new TextEncoder().encode(file.contents).byteLength
    if (bytes > MAX_SOURCE_BYTES)
      throw new Error('Sources exceed the 8 MiB limit')
  }
  for (const path of paths) {
    const segments = path.split('/')
    while (segments.length > 1) {
      segments.pop()
      if (paths.has(segments.join('/')))
        throw new Error('A source path is both a file and a directory')
    }
  }
  return files
}
