import {
  DotsThreeIcon,
  GearIcon,
  GitCommitIcon,
  HammerIcon,
  PlayIcon,
} from '@phosphor-icons/react'
import { Button } from '@v5x/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@v5x/ui/components/dropdown-menu'
import { Kbd } from '@v5x/ui/components/kbd'
import { Spinner } from '@v5x/ui/components/spinner'

export function describeBuildElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  const minuteLabel = minutes === 1 ? 'minute' : 'minutes'
  const secondLabel = remainingSeconds === 1 ? 'second' : 'seconds'
  if (minutes === 0) return `${remainingSeconds} ${secondLabel}`

  const remainingTime =
    remainingSeconds === 0 ? '' : `, ${remainingSeconds} ${secondLabel}`

  return `${minutes} ${minuteLabel}${remainingTime}`
}

export function CommitButton({
  disabled,
  onCommit,
}: {
  disabled: boolean
  onCommit: () => void
}) {
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label="Commit changes"
      title="Commit changes"
      onClick={onCommit}
      disabled={disabled}
    >
      <GitCommitIcon />
    </Button>
  )
}

export function BuildButton({
  isBuilding,
  elapsedSeconds,
  label,
  disabled,
  onBuild,
  onCancel,
}: {
  isBuilding: boolean
  elapsedSeconds: number
  label: string
  disabled: boolean
  onBuild: () => void
  onCancel: () => void
}) {
  if (isBuilding)
    return (
      <Button
        size="xs"
        variant="ghost"
        aria-label={`Cancel build, ${describeBuildElapsed(elapsedSeconds)} elapsed`}
        title={`Cancel build, ${elapsedSeconds}s elapsed`}
        onClick={onCancel}
      >
        <Spinner data-icon="inline-start" aria-hidden="true" />
        <span className="min-w-[3ch] text-center font-mono tabular-nums">
          {elapsedSeconds}s
        </span>
      </Button>
    )

  return (
    <Button
      size="sm"
      aria-label={label}
      title={label}
      onClick={onBuild}
      disabled={disabled}
    >
      <HammerIcon data-icon="inline-start" />
      Build <Kbd>⌘/Ctrl B</Kbd>
    </Button>
  )
}

export function SimulatorButton({
  supported,
  disabled,
  busy,
  onRun,
}: {
  supported: boolean
  disabled: boolean
  busy: boolean
  onRun: () => void
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      aria-label="Run in simulator"
      title={
        supported
          ? 'Run in simulator'
          : 'This template cannot run in the simulator.'
      }
      onClick={onRun}
      disabled={disabled}
    >
      {busy ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <PlayIcon data-icon="inline-start" />
      )}
      Run
    </Button>
  )
}

export function BuildSettingsMenu({
  remote,
  disabled,
  onOpenCompilationServer,
  onResetBrowserCompiler,
}: {
  remote: boolean
  disabled: boolean
  onOpenCompilationServer: () => void
  onResetBrowserCompiler: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="More actions"
            title="More actions"
          />
        }
      >
        <DotsThreeIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={disabled}
            onClick={onOpenCompilationServer}
          >
            <GearIcon />
            Compilation server
            {remote ? ' · Remote' : ' · Browser'}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled}
            onClick={onResetBrowserCompiler}
          >
            <GearIcon />
            Reset browser compiler
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function StatusMessages({ messages }: { messages: Array<string> }) {
  return (
    <span className="truncate text-xs" role="status" aria-live="polite">
      {messages.filter(Boolean).join('. ')}
    </span>
  )
}
