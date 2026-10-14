import * as React from 'react'
import {
  compilationServerUrl,
  testCompilationServer,
} from '@v5x/compiler/remote-build'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'

export const compilationServerStorageKey = 'v5x-compilation-server-url'

export function CompilationServerDialog({
  open,
  onOpenChange,
  endpoint,
  onConnect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  endpoint: string
  onConnect: (endpoint: string) => void
}) {
  const [url, setUrl] = React.useState(endpoint)
  const [error, setError] = React.useState('')
  const [connecting, setConnecting] = React.useState(false)
  const abortRef = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    if (open) {
      setUrl(endpoint)
      setError('')
    }
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [open, endpoint])

  const connect = async (event: React.FormEvent) => {
    event.preventDefault()
    const controller = new AbortController()
    abortRef.current = controller
    setConnecting(true)
    setError('')
    try {
      const next = compilationServerUrl(url.trim())
      await testCompilationServer(next, controller.signal)
      if (controller.signal.aborted) return
      onConnect(next)
      onOpenChange(false)
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setConnecting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Compilation server</DialogTitle>
          <DialogDescription>
            Build on a faster computer. Your project files are sent to the
            server you connect to.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void connect(event)}
          className="flex flex-col gap-4"
        >
          <p className="text-sm">On that computer, run:</p>
          <code className="break-all rounded-md bg-muted p-2 text-xs">
            bunx @v5x/compile-server --host 0.0.0.0
          </code>
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="compilation-server-url">
                WebSocket URL
              </FieldLabel>
              <Input
                id="compilation-server-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="wss://your-server/compile?token=…"
                autoComplete="off"
                spellCheck={false}
                disabled={connecting}
                aria-invalid={Boolean(error)}
                aria-describedby="compilation-server-description"
              />
              <FieldDescription id="compilation-server-description">
                Paste the URL printed by the server, including its token.
                Replace &lt;server-host&gt; with its address. For a remote
                server used from HTTPS, configure TLS with --cert and --key, or
                a secure tunnel.
              </FieldDescription>
              {error && <FieldError>{error}</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={connecting}
              onClick={() => {
                onConnect('')
                onOpenChange(false)
              }}
            >
              Use browser
            </Button>
            <Button type="submit" disabled={connecting || !url.trim()}>
              {connecting && <Spinner data-icon="inline-start" />}
              {connecting ? 'Connecting' : 'Connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
