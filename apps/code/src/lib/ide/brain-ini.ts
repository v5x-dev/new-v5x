import { FileExitAction, ProgramIniConfig } from '@v5x/serial'
import type { ProjectTemplate } from '@v5x/compiler'

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
