/** Development-only browser acceptance harness. Uses the production editor and real WASM clangd, without repository credentials. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ezTemplateFiles } from '../convex/ezTemplate'
import { jarTemplateFiles } from '../convex/jarTemplate'
import { WorkspaceEditor } from './components/ide/workspace-editor'
import { ProgramFileTree } from './components/ide/program-file-tree'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarProvider,
} from './components/ui/sidebar'
import type { FileOperations } from '~/lib/ide/file-operations'
import type { ProjectTemplate } from './lib/ide/compile-commands'
import './styles/app.css'

const vexFiles: Record<string, string> = {
  'include/vex.h':
    '#include <math.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include "v5.h"\n#include "v5_vcs.h"\n',
  'include/robot.h': '#pragma once\nint targetSpeed(int requested);\n',
  'src/robot.cpp':
    '#include "robot.h"\n\nint targetSpeed(int requested) {\n  return requested > 100 ? 100 : requested;\n}\n',
  'src/main.cpp':
    '#include "vex.h"\n#include "robot.h"\n\nusing namespace vex;\n\nbrain Brain;\nmotor LeftMotor(PORT1);\n\nint main() {\n  const int speed = targetSpeed(75);\n  LeftMotor.spin(forward, speed, percent);\n  Brain.Screen.print("Ready to drive");\n  return 0;\n}\n',
  '.clang-format': 'BasedOnStyle: LLVM\nIndentWidth: 2\n',
  'README.md':
    '# Local browser validation\n\nThis workspace uses real VEX SDK headers and clangd WebAssembly.\n',
}
const templates: Record<ProjectTemplate, Record<string, string>> = {
  vexcode: vexFiles,
  pros: {
    'include/main.h': '#pragma once\n#include "api.h"\n',
    'src/main.cpp':
      '#include "main.h"\n\nvoid initialize() {\n  pros::lcd::initialize();\n  pros::lcd::set_text(1, "Local clangd");\n}\n\nvoid opcontrol() {\n  pros::Motor drive(1);\n  drive.move(75);\n}\n',
    'project.pros': '{"kernel":"3.8.3"}',
  },
  'ez-template': ezTemplateFiles,
  'jar-template': jarTemplateFiles,
}
function ValidationWorkspace() {
  const [template, setTemplate] = React.useState<ProjectTemplate>('vexcode')
  const [path, setPath] = React.useState('src/main.cpp')
  const [paths, setPaths] = React.useState<Array<string>>([])
  const [sha, setSha] = React.useState('validation-initial')
  const repository = React.useRef({ ...templates[template] })
  const fileOperationsRef = React.useRef<FileOperations | null>(null)
  const saveHandlerRef = React.useRef<(() => Promise<void>) | null>(null)
  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <Sidebar variant="floating">
        <SidebarContent className="min-h-0 p-0">
          <ProgramFileTree
            fileOperationsRef={fileOperationsRef}
            paths={paths}
            selectedFile={path}
            onSelect={(file) => {
              setPath(file)
              return true
            }}
          />
        </SidebarContent>
        <SidebarFooter>
          <select
            aria-label="Project template"
            value={template}
            onChange={(event) => {
              const value = event.target.value as ProjectTemplate
              repository.current = { ...templates[value] }
              setTemplate(value)
              setSha('validation-initial')
              setPath('src/main.cpp')
            }}
            className="rounded border bg-background px-2 py-1 text-xs"
          >
            {Object.keys(templates).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="relative h-svh min-h-0 overflow-hidden">
        <WorkspaceEditor
          key={template}
          workspaceId={`validation-${template}`}
          template={template}
          selectedFile={path}
          commitSha={sha}
          loadSnapshot={() =>
            Promise.resolve({
              files: repository.current,
              commitSha: sha,
            })
          }
          commitChanges={(changes, expected, _message) => {
            if (expected !== sha) throw new Error('Validation snapshot changed')
            for (const change of changes) {
              if (change.contents === null)
                delete repository.current[change.path]
              else repository.current[change.path] = change.contents
            }
            const next = crypto.randomUUID()
            setSha(next)
            return Promise.resolve(next)
          }}
          onSelect={setPath}
          onPathsChange={setPaths}
          onDirtyChange={() => {}}
          onSavingChange={() => {}}
          saveHandlerRef={saveHandlerRef}
          fileOperationsRef={fileOperationsRef}
        />
      </SidebarInset>
    </SidebarProvider>
  )
}
createRoot(document.getElementById('root')!).render(<ValidationWorkspace />)
