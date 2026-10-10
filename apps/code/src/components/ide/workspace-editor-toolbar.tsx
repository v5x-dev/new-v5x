import {
  CheckIcon,
  CircuitryIcon,
  MagnifyingGlassIcon,
  TerminalIcon,
  TextAlignLeftIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import type { WorkspacePanel, WorkspaceProblem } from './workspace-panels'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'

interface Props {
  hasBrainTerminal: boolean
  problems: Array<WorkspaceProblem>
  panel: WorkspacePanel
  setPanel: (panel: WorkspacePanel) => void
  searchOpen: boolean
  openSearch: () => void
  showingHeader: boolean
  ready: boolean
  hasSelectedFile: boolean
  onFormat: () => void
  children?: React.ReactNode
}

export function WorkspaceEditorToolbar({
  hasBrainTerminal,
  problems,
  panel,
  setPanel,
  searchOpen,
  openSearch,
  showingHeader,
  ready,
  hasSelectedFile,
  onFormat,
  children,
}: Props) {
  return (
    <div className="relative z-20 mx-2 mb-2 mt-2 flex h-9 shrink-0 items-center gap-2 px-2 text-muted-foreground">
      <div className="flex items-center gap-0.5">
        {problems.some(
          ({ diagnostic }) =>
            diagnostic.severity === 1 || diagnostic.severity === 2,
        ) && (
          <Button
            variant="ghost"
            size="icon-xs"
            title={`${problems.filter(({ diagnostic }) => diagnostic.severity === 1).length} errors, ${problems.filter(({ diagnostic }) => diagnostic.severity === 2).length} warnings (Ctrl+J)`}
            aria-label="Toggle problems panel"
            onClick={() => setPanel(panel ? null : 'problems')}
          >
            <WarningCircleIcon />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Output"
          title="Output"
          onClick={() => setPanel(panel === 'output' ? null : 'output')}
        >
          <TerminalIcon />
        </Button>
        {hasBrainTerminal && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Brain terminal"
            title="Brain terminal"
            aria-pressed={panel === 'terminal'}
            onClick={() => setPanel(panel === 'terminal' ? null : 'terminal')}
          >
            <CircuitryIcon />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
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
            size="icon-xs"
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
          className="inline-flex size-6 shrink-0 items-center justify-center"
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
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        {children}
      </div>
    </div>
  )
}
