export function parseProgramFilePaths(result: unknown): string[] {
  // Older Convex deployments return the paths directly.
  const paths = Array.isArray(result)
    ? result
    : result !== null && typeof result === 'object' && 'paths' in result
      ? result.paths
      : undefined

  if (
    !Array.isArray(paths) ||
    !paths.every((path) => typeof path === 'string')
  ) {
    throw new Error('Could not load program files: invalid file list.')
  }

  return paths
}
