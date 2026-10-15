export const BRAIN_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const

export interface UploadArtifacts {
  programBytes: Uint8Array
  coldBytes?: Uint8Array
}

const isCold = (path: string) => path.endsWith('cold.package.bin')
const isHot = (path: string) => path.endsWith('hot.package.bin')

// Upload the selected artifact when it is a program binary. Otherwise prefer
// the PROS hot package, then the first non-cold artifact. A hot package
// always travels with its cold package.
export function selectUploadArtifacts(
  artifacts: ReadonlyMap<string, Uint8Array>,
  selectedPath: string | undefined,
): UploadArtifacts | null {
  const paths = [...artifacts.keys()]

  const programPath =
    selectedPath && artifacts.has(selectedPath) && !isCold(selectedPath)
      ? selectedPath
      : (paths.find(isHot) ?? paths.find((path) => !isCold(path)))

  const programBytes = programPath ? artifacts.get(programPath) : undefined
  if (!programPath || !programBytes) return null

  const coldPath = isHot(programPath) ? paths.find(isCold) : undefined

  return {
    programBytes,
    coldBytes: coldPath ? artifacts.get(coldPath) : undefined,
  }
}

export function parseBrainSlot(value: string | null) {
  const slot = Number(value)
  return Number.isInteger(slot) && slot >= 1 && slot <= 8 ? slot : 1
}
