import type { Dispatch, SetStateAction } from 'react'
import type { Diagnostic } from 'vscode-languageserver-protocol'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet'

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
  return (
    <>
      {(['problems', 'output'] as const).map((sheetPanel) => (
        <Sheet
          key={sheetPanel}
          open={panel === sheetPanel}
          onOpenChange={(open) => {
            if (!open)
              setPanel((current) => (current === sheetPanel ? null : current))
          }}
        >
          <SheetContent
            side="bottom"
            className="max-h-[80vh] gap-0 data-[side=bottom]:h-[50vh]"
          >
            <SheetHeader>
              <SheetTitle>
                {sheetPanel === 'problems'
                  ? `Problems${problems.length ? ` (${problems.length})` : ''}`
                  : 'Output'}
              </SheetTitle>
              <SheetDescription>
                {sheetPanel === 'problems'
                  ? 'Diagnostics for project files.'
                  : 'Compiler output from the latest build.'}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
              {sheetPanel === 'output' ? (
                <Card size="sm" className="h-full bg-background ring-inset">
                  <CardContent className="min-h-0 flex-1 overflow-auto">
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                      {buildOutput ||
                        'Build the project to see compiler output.'}
                    </pre>
                  </CardContent>
                </Card>
              ) : problems.length ? (
                problems.map(({ path, diagnostic }, index) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    key={`${path}:${index}`}
                    className="mb-1 h-auto w-full items-start justify-start gap-3 whitespace-normal px-3 py-3 text-left"

                    onClick={() => {
                      onSelect({ path, diagnostic })
                    }}
                  >
                    <span
                      className={
                        diagnostic.severity === 1
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      }
                    >
                      {diagnostic.severity === 1
                        ? 'Error'
                        : diagnostic.severity === 2
                          ? 'Warning'
                          : 'Info'}
                    </span>
                    <span className="min-w-0 flex-1">
                      {diagnostic.message}
                      <span className="mt-1 block text-muted-foreground">
                        {path}:{diagnostic.range.start.line + 1}:
                        {diagnostic.range.start.character + 1}
                      </span>
                    </span>
                  </Button>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">
                  {ready
                    ? 'No problems reported.'
                    : 'Waiting for C++ analysis…'}
                </p>
              )}
            </div>
          </SheetContent>
        </Sheet>
      ))}
    </>
  )
}
