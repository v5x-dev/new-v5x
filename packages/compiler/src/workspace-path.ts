export function validPath(path: string) {
  return (
    !!path &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !path.split('/').some((part) => !part || part === '.' || part === '..')
  )
}
