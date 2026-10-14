import type { Dispatch, SetStateAction } from 'react'
import type { Diagnostic } from 'vscode-languageserver-protocol'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'

export type WorkspacePanel = 'problems' | 'output' | 'terminal' | null

export interface WorkspaceProblem {
  path: string
  diagnostic: Diagnostic
}

interface Props {
  panel: WorkspacePanel
  setPanel: Dispatch<SetStateAction<WorkspacePanel>>
  problems: Array<WorkspaceProblem>
  buildOutput?: string
  ready: boolean
  onSelect: (problem: WorkspaceProblem) => void
}

export function WorkspacePanels({
  panel,
  setPanel,
  problems,
  buildOutput,
  ready,
  onSelect,
}: Props) {
  if (panel !== 'problems' && panel !== 'output') return null

  return (
    <section
      aria-label={panel === 'problems' ? 'Problems' : 'Output'}
      className="flex h-full min-h-0 flex-col gap-2 p-3"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">
          {panel === 'problems' ? `Problems (${problems.length})` : 'Output'}
        </h2>
        <Button variant="ghost" size="xs" onClick={() => setPanel(null)}>
          Close panel
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {panel === 'output' ? (
          <Card size="sm">
            <CardContent>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                {buildOutput || 'Build the project to see compiler output.'}
              </pre>
            </CardContent>
          </Card>
        ) : problems.length ? (
          problems.map(({ path, diagnostic }, index) => (
            <Button
              variant="ghost"
              size="sm"
              key={`${path}:${index}`}
              className="h-auto w-full justify-start whitespace-normal text-left"
              onClick={() => onSelect({ path, diagnostic })}
            >
              <span>
                {diagnostic.severity === 1 ? 'Error' : 'Warning'}:{' '}
                {diagnostic.message}
                <span className="block text-muted-foreground">
                  {path}:{diagnostic.range.start.line + 1}:
                  {diagnostic.range.start.character + 1}
                </span>
              </span>
            </Button>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">
            {ready ? 'No problems reported.' : 'Waiting for C++ analysis…'}
          </p>
        )}
      </div>
    </section>
  )
}
