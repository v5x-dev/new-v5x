import {
  CheckIcon,
  MagnifyingGlassIcon,
  TerminalIcon,
  TextAlignLeftIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import type { WorkspacePanel, WorkspaceProblem } from './workspace-panels'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'

interface Props {
  problems: Array<WorkspaceProblem>
  panel: WorkspacePanel
  setPanel: (panel: WorkspacePanel) => void
  searchOpen: boolean
  openSearch: () => void
  showingHeader: boolean
  ready: boolean
  hasSelectedFile: boolean
  onFormat: () => void
}

export function WorkspaceEditorToolbar({
  problems,
  panel,
  setPanel,
  searchOpen,
  openSearch,
  showingHeader,
  ready,
  hasSelectedFile,
  onFormat,
}: Props) {
  return (
    <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2 text-muted-foreground">
      <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm backdrop-blur-sm">
        {problems.some(
          ({ diagnostic }) =>
            diagnostic.severity === 1 || diagnostic.severity === 2,
        ) && (
          <Button
            variant="ghost"
            size="icon-sm"
            title={`${problems.filter(({ diagnostic }) => diagnostic.severity === 1).length} errors, ${problems.filter(({ diagnostic }) => diagnostic.severity === 2).length} warnings (Ctrl+J)`}
            aria-label="Toggle problems panel"
            onClick={() => setPanel(panel ? null : 'problems')}
          >
            <WarningCircleIcon />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Output"
          title="Output"
          onClick={() => setPanel(panel === 'output' ? null : 'output')}
        >
          <TerminalIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Search project (Ctrl+Shift+F)"
          aria-label="Search project"
          aria-pressed={searchOpen}
          className={searchOpen ? 'bg-muted text-foreground' : undefined}
          onClick={openSearch}
        >
          <MagnifyingGlassIcon />
        </Button>
        {!showingHeader && (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!ready || !hasSelectedFile}
            title="Format document (Shift+Alt+F)"
            aria-label="Format document"
            onClick={onFormat}
          >
            <TextAlignLeftIcon />
          </Button>
        )}
        <span
          role="status"
          className="inline-flex size-7 shrink-0 items-center justify-center"
          title={ready ? 'C++ ready' : 'Starting C++'}
          aria-label={ready ? 'C++ ready' : 'Starting C++'}
        >
          {ready ? (
            <CheckIcon className="size-4 text-emerald-500" aria-hidden="true" />
          ) : (
            <Spinner aria-hidden="true" />
          )}
        </span>
      </div>
    </div>
  )
}
