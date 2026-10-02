import * as React from 'react'
import { File, type FileProps } from '@pierre/diffs/react'
import { XIcon } from '@phosphor-icons/react'
import type { LspLocation } from '~/lib/language-server-client'
import { Spinner } from './ui/spinner'

export function LspSdkDefinition({
  location,
  contents,
  error,
  options,
  onClose,
}: {
  location: LspLocation | null
  contents: string | null
  error?: string
  options: FileProps<undefined, undefined>['options']
  onClose: () => void
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const scrolled = React.useRef(false)
  const line = (location?.range.start.line ?? 0) + 1
  React.useEffect(() => {
    closeRef.current?.focus()
  }, [])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Code definition"
        className="flex h-[80vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border bg-background shadow-xl"
      >
        <header className="flex items-center gap-3 border-b px-4 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-sm">
            {location
              ? `${decodeURIComponent(new URL(location.uri).pathname)}:${line}`
              : 'Definition'}
          </span>
          {location ? (
            <span className="text-xs text-muted-foreground">
              SDK · Read only
            </span>
          ) : null}
          <button
            ref={closeRef}
            className="rounded p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onClose}
            aria-label="Close code definition"
          >
            <XIcon aria-hidden="true" className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {error ? (
            <p role="alert" className="p-4 text-sm text-destructive">
              {error}
            </p>
          ) : contents === null || !location ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Loading definition…
            </div>
          ) : (
            <File
              file={{
                name: decodeURIComponent(new URL(location.uri).pathname),
                contents,
              }}
              selectedLines={{
                start: line,
                end: Math.max(line, location.range.end.line + 1),
              }}
              options={{
                ...options,
                onTokenClick: undefined,
                onTokenEnter: undefined,
                onTokenLeave: undefined,
                onPostRender(node) {
                  if (scrolled.current) return
                  const target = node.shadowRoot?.querySelector(
                    `[data-line="${line}"]`,
                  )
                  if (target) {
                    scrolled.current = true
                    target.scrollIntoView({ block: 'center', inline: 'start' })
                    // A long code row can scroll its shadow DOM containers horizontally.
                    // Keep the declaration vertically centered without clipping its start.
                    for (const element of node.shadowRoot?.querySelectorAll<HTMLElement>(
                      '*',
                    ) ?? []) {
                      if (element.scrollLeft !== 0) element.scrollLeft = 0
                    }
                    node.scrollLeft = 0
                    if (node.parentElement) node.parentElement.scrollLeft = 0
                  }
                },
              }}
              style={
                {
                  '--diffs-font-family': 'var(--font-mono)',
                } as React.CSSProperties
              }
            />
          )}
        </div>
      </section>
    </div>
  )
}
