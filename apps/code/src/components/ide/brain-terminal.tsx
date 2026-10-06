import {
  ArrowClockwiseIcon,
  PaperPlaneTiltIcon,
  PlugIcon,
  PlugsIcon,
  SpinnerGapIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react'
import * as React from 'react'
import type { V5SerialDevice, V5UserProgramTerminal } from '@v5x/serial'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from '~/components/ui/sheet'

export interface BrainTerminalProps {
  brainDevice: V5SerialDevice | null
  connectBrain: () => Promise<V5SerialDevice>
  disconnectBrain: () => Promise<void>
  isUploading: boolean
}

const MAX_OUTPUT_LENGTH = 200_000

export function BrainTerminal({
  brainDevice,
  connectBrain,
  disconnectBrain,
  isUploading,
  open,
  onOpenChange,
}: BrainTerminalProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const terminalRef = React.useRef<V5UserProgramTerminal | null>(null)
  const outputRef = React.useRef<HTMLPreElement>(null)
  const followOutput = React.useRef(true)
  const [output, setOutput] = React.useState('')
  const [input, setInput] = React.useState('')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [session, setSession] = React.useState(0)

  React.useEffect(() => {
    if (!brainDevice || isUploading) return
    const terminal = brainDevice.openTerminal()
    if (!terminal) return
    terminalRef.current = terminal
    setRunning(true)
    setError('')

    const onText = (text: string) => {
      setOutput((current) => (current + text).slice(-MAX_OUTPUT_LENGTH))
      setError('')
    }
    const onError = (reason: Error) => setError(reason.message)
    const onClosed = () => setRunning(false)
    terminal.on('text', onText)
    terminal.on('error', onError)
    terminal.on('closed', onClosed)

    return () => {
      terminalRef.current = null
      setRunning(false)
      terminal.remove('text', onText)
      terminal.remove('error', onError)
      terminal.remove('closed', onClosed)
      void terminal.close()
    }
  }, [brainDevice, isUploading, session])

  React.useEffect(() => {
    if (followOutput.current && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output, open])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const send = () =>
    run(async () => {
      const terminal = terminalRef.current
      if (!terminal?.isRunning)
        throw new Error('Connect the Brain before sending input.')
      const text = `${input}\n`
      const written = await terminal.write(text)
      if (written !== new TextEncoder().encode(text).byteLength) {
        throw new Error(
          'Could not send all input to the Brain. Check the connection before retrying.',
        )
      }
      setInput('')
    })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[80vh] gap-0 data-[side=bottom]:h-[50vh]"
      >
        <SheetTitle className="sr-only">Brain terminal</SheetTitle>
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={brainDevice ? 'Disconnect Brain' : 'Connect Brain'}
              title={brainDevice ? 'Disconnect Brain' : 'Connect Brain'}
              disabled={busy || isUploading}
              onClick={() =>
                void run(async () => {
                  if (brainDevice) await disconnectBrain()
                  else await connectBrain()
                })
              }
            >
              {busy ? (
                <SpinnerGapIcon className="animate-spin" />
              ) : brainDevice ? (
                <PlugsIcon />
              ) : (
                <PlugIcon />
              )}
            </Button>
            {brainDevice && !running && !isUploading && (
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="Restart terminal"
                title="Restart terminal"
                disabled={busy}
                onClick={() => setSession((current) => current + 1)}
              >
                <ArrowClockwiseIcon />
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Clear output"
              title="Clear output"
              onClick={() => {
                setOutput('')
                followOutput.current = true
              }}
            >
              <TrashIcon />
            </Button>
            <span role="status" className="text-xs text-muted-foreground">
              {isUploading
                ? 'Terminal paused during upload'
                : running
                  ? 'Connected'
                  : brainDevice
                    ? 'Terminal stopped'
                    : 'Disconnected'}
            </span>
            <SheetClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  aria-label="Close terminal"
                  title="Close terminal"
                />
              }
            >
              <XIcon />
            </SheetClose>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <pre
            ref={outputRef}
            tabIndex={0}
            aria-label="Brain terminal output"
            className="min-h-0 flex-1 overflow-auto rounded-lg border bg-background p-3 font-mono text-xs whitespace-pre-wrap break-words"
            onScroll={(event) => {
              const element = event.currentTarget
              followOutput.current =
                element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight <
                32
            }}
          >
            {output || 'Waiting for program output…'}
          </pre>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!busy && running && !isUploading) void send()
            }}
          >
            <Input
              aria-label="Brain terminal input"
              placeholder="Send input to the program (Enter sends a newline)"
              className="font-mono"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={!running || busy || isUploading}
            />
            <Button
              type="submit"
              aria-label="Send input"
              title="Send input"
              size="icon-sm"
              disabled={!running || busy || isUploading}
            >
              <PaperPlaneTiltIcon />
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  )
}
