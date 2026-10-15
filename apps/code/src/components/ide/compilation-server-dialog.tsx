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
  const [token, setToken] = React.useState('')
  const [error, setError] = React.useState('')
  const [connecting, setConnecting] = React.useState(false)
  const abortRef = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    if (open) {
      try {
        const saved = new URL(endpoint)
        setToken(saved.searchParams.get('token') ?? '')
        saved.searchParams.delete('token')
        setUrl(saved.href)
      } catch {
        setUrl(endpoint)
        setToken('')
      }
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
      const next = compilationServerUrl(url, token)
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
            Build and run C++ language analysis on a faster computer. Your
            project files are sent to the server you connect to, keeping the
            compiler and language server out of this tab.
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
                placeholder="https://your-tunnel.trycloudflare.com"
                autoComplete="off"
                spellCheck={false}
                disabled={connecting}
                aria-invalid={Boolean(error)}
                aria-describedby="compilation-server-description"
              />
              <FieldDescription id="compilation-server-description">
                Paste your Cloudflare tunnel URL or the server's WebSocket URL.
                We add /compile automatically. Remote connections from HTTPS
                require a secure tunnel or TLS.
              </FieldDescription>
              {error && <FieldError>{error}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="compilation-server-token">
                Access token
              </FieldLabel>
              <Input
                id="compilation-server-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={connecting}
                aria-describedby="compilation-server-token-description"
              />
              <FieldDescription id="compilation-server-token-description">
                Copy the value after token= from the server's terminal. You can
                also paste the full URL with its token above.
              </FieldDescription>
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
