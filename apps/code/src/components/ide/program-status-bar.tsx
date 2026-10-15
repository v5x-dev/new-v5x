import {
  DotsThreeIcon,
  GearIcon,
  GitCommitIcon,
  HammerIcon,
  InfoIcon,
  PlayIcon,
} from '@phosphor-icons/react'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Kbd } from '~/components/ui/kbd'
import { Spinner } from '~/components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '~/components/ui/tooltip'

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
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Commit changes"
            onClick={onCommit}
            disabled={disabled}
          />
        }
      >
        <GitCommitIcon />
      </TooltipTrigger>
      <TooltipContent>Commit changes</TooltipContent>
    </Tooltip>
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
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Cancel build, ${describeBuildElapsed(elapsedSeconds)} elapsed`}
              onClick={onCancel}
            />
          }
        >
          <Spinner aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>
          Cancel build · {describeBuildElapsed(elapsedSeconds)} elapsed
        </TooltipContent>
      </Tooltip>
    )

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={label}
            onClick={onBuild}
            disabled={disabled}
          />
        }
      >
        <HammerIcon />
      </TooltipTrigger>
      <TooltipContent>
        {label} <Kbd>⌘/Ctrl B</Kbd>
      </TooltipContent>
    </Tooltip>
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
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Run in simulator"
            onClick={onRun}
            disabled={disabled}
          />
        }
      >
        {busy ? <Spinner /> : <PlayIcon />}
      </TooltipTrigger>
      <TooltipContent>
        {supported
          ? 'Run in simulator'
          : 'This template cannot run in the simulator.'}
      </TooltipContent>
    </Tooltip>
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
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="More actions"
                />
              }
            />
          }
        >
          <DotsThreeIcon />
        </TooltipTrigger>
        <TooltipContent>More actions</TooltipContent>
      </Tooltip>
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
  const visibleMessages = messages.filter(Boolean)
  const statusText = visibleMessages.join('. ')

  if (!statusText) return null

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {statusText}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground"
              aria-label="Build and connection status"
              tabIndex={0}
            />
          }
        >
          <InfoIcon aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">
          <span className="flex flex-col gap-1">
            {visibleMessages.map((message, index) => (
              <span key={`${index}-${message}`}>{message}</span>
            ))}
          </span>
        </TooltipContent>
      </Tooltip>
    </>
  )
}
