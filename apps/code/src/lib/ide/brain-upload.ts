import { FileExitAction, ProgramIniConfig } from '@v5x/serial'
import type { ProjectTemplate } from '@v5x/compiler'

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

export function createProgramIni(options: {
  name: string
  slot: number
  template: ProjectTemplate
  pros: boolean
}) {
  const ini = new ProgramIniConfig()
  ini.baseName = `slot_${options.slot}`
  ini.program.name = options.name
  ini.program.slot = (options.slot - 1) as typeof ini.program.slot
  ini.program.description = 'Built with v5x'
  ini.project.ide = options.pros ? 'PROS' : 'VEXcode'

  if (options.pros) {
    ini.libraryTemplates =
      options.template === 'ez-template'
        ? ['kernel', 'liblvgl', 'EZ-Template', 'okapilib']
        : ['kernel']
  }

  ini.autorun = false
  ini.after = FileExitAction.EXIT_NONE
  ini.setProgramDate(new Date())
  return ini
}

export function parseBrainSlot(value: string | null) {
  const slot = Number(value)
  return Number.isInteger(slot) && slot >= 1 && slot <= 8 ? slot : 1
}
