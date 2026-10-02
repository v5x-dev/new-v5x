import * as React from 'react'
import { MultiFileDiff, type FileProps } from '@pierre/diffs/react'
import type { FeatureItem, LspFeatures } from '~/lib/use-lsp-features'
import { LspDialog } from './lsp-dialog'
import { LspHover, HighlightedCode } from './lsp-hover'
import { Spinner } from './ui/spinner'

function FeatureRow({
  item,
  onChoose,
  depth = 0,
}: {
  item: FeatureItem
  onChoose: (item: FeatureItem) => void
  depth?: number
}) {
  const [children, setChildren] = React.useState<FeatureItem[] | null>(null)
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  return (
    <>
      <div
        className="flex items-center gap-1"
        style={{ paddingLeft: depth * 16 }}
      >
        {item.children ? (
          <button
            aria-label={`Expand ${item.label}`}
            aria-expanded={open}
            className="shrink-0 px-2 py-1"
            onClick={async () => {
              setOpen(!open)
              if (children || open || !item.children) return
              setLoading(true)
              try {
                setChildren(await item.children())
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : 'Could not load children',
                )
              } finally {
                setLoading(false)
              }
            }}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-7 shrink-0" />
        )}
        <button
          className="min-w-0 flex-1 rounded px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
          disabled={!!item.disabled}
          title={item.disabled}
          onClick={() => onChoose(item)}
        >
          <span className="block whitespace-pre-wrap font-mono text-xs">
            {item.label}
          </span>
          {item.detail ? (
            <span className="block truncate text-xs text-muted-foreground">
              {item.detail}
            </span>
          ) : null}
        </button>
      </div>
      {open ? (
        <div>
          {loading ? (
            <Spinner className="m-3" />
          ) : error ? (
            <p className="p-2 text-xs text-destructive">{error}</p>
          ) : children?.length ? (
            children.map((child, i) => (
              <FeatureRow
                key={`${child.label}-${i}`}
                item={child}
                onChoose={onChoose}
                depth={depth + 1}
              />
            ))
          ) : (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              No results
            </p>
          )}
        </div>
      ) : null}
    </>
  )
}

function FeatureList({ features }: { features: LspFeatures }) {
  const panel = features.panel!
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState(0)
  const searchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const items = panel.search
    ? panel.items
    : panel.items.filter((item) =>
        `${item.label} ${item.detail ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
  const choose = (item: FeatureItem) => {
    if (item.disabled) return
    if (item.location) features.navigate(item.location)
    else if (item.action)
      void Promise.resolve(item.action()).catch(features.fail)
  }
  React.useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    },
    [],
  )
  return (
    <LspDialog title={panel.title} onClose={features.closePanel}>
      <input
        autoFocus
        aria-label={`Filter ${panel.title}`}
        placeholder="Type to filter…"
        value={query}
        className="m-3 rounded border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        onChange={(event) => {
          const value = event.target.value
          setQuery(value)
          setSelected(0)
          if (panel.search) {
            if (searchTimer.current) clearTimeout(searchTimer.current)
            searchTimer.current = setTimeout(() => panel.search?.(value), 200)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const next = Math.max(
              0,
              Math.min(
                items.length - 1,
                selected + (event.key === 'ArrowDown' ? 1 : -1),
              ),
            )
            setSelected(next)
            listRef.current?.children[next]?.scrollIntoView({
              block: 'nearest',
            })
          } else if (event.key === 'Enter' && items[selected]) {
            event.preventDefault()
            choose(items[selected])
          }
        }}
      />
      <div
        ref={listRef}
        className="min-h-24 overflow-y-auto px-2 pb-3"
        role="list"
        aria-label={panel.title}
      >
        {panel.loading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm">
            <Spinner /> Loading…
          </div>
        ) : panel.error ? (
          <p role="alert" className="p-3 text-sm text-destructive">
            {panel.error}
          </p>
        ) : items.length ? (
          items.map((item, i) => (
            <div
              role="listitem"
              key={`${item.label}-${i}`}
              className={i === selected ? 'rounded bg-accent/50' : ''}
            >
              <FeatureRow item={item} onChoose={choose} />
            </div>
          ))
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No results</p>
        )}
      </div>
    </LspDialog>
  )
}

export function LspFeatureDialogs({
  features,
  options,
}: {
  features: LspFeatures
  options: FileProps<undefined, undefined>['options']
}) {
  return (
    <>
      {features.panel ? (
        <FeatureList key={features.panel.title} features={features} />
      ) : null}
      {features.rename ? (
        <LspDialog title="Rename Symbol" onClose={features.closeRename}>
          <RenameForm features={features} />
        </LspDialog>
      ) : null}
      {features.preview ? (
        <LspDialog
          title={features.preview.title}
          onClose={features.closePreview}
          wide
        >
          <div className="min-h-0 overflow-y-auto overscroll-contain p-3">
            {features.preview.changes.map((change, i) => (
              <details
                key={change.path}
                open={i === 0}
                className="mb-3 rounded border"
              >
                <summary className="cursor-pointer px-3 py-2 font-mono text-xs">
                  {change.path}
                </summary>
                <MultiFileDiff
                  oldFile={{ name: change.path, contents: change.before }}
                  newFile={{ name: change.path, contents: change.after }}
                  options={{
                    theme: options?.theme,
                    diffStyle: 'unified',
                    disableFileHeader: true,
                  }}
                />
              </details>
            ))}
          </div>
          <footer className="flex justify-end gap-2 border-t p-3">
            <button
              className="rounded border px-3 py-1.5 text-sm"
              onClick={features.closePreview}
            >
              Cancel
            </button>
            <button
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              onClick={features.applyPreview}
            >
              Apply to drafts
            </button>
          </footer>
        </LspDialog>
      ) : null}
    </>
  )
}

function RenameForm({ features }: { features: LspFeatures }) {
  const rename = features.rename!
  const [name, setName] = React.useState(rename.value)
  React.useEffect(() => {
    setName(rename.value)
  }, [rename.value])
  return (
    <form
      className="p-4"
      onSubmit={(event) => {
        event.preventDefault()
        void features.commitRename(name, false)
      }}
    >
      <input
        autoFocus
        aria-label="New symbol name"
        className="w-full rounded border bg-background px-3 py-2 font-mono text-sm"
        value={name}
        disabled={rename.loading}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void features.commitRename(name, true)
          }
        }}
      />
      {rename.loading ? (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <Spinner /> Preparing rename…
        </div>
      ) : null}
      {rename.error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {rename.error}
        </p>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={rename.loading}
          className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          Rename
        </button>
        <button
          type="button"
          disabled={rename.loading}
          className="rounded border px-3 py-1.5 text-sm"
          onClick={() => void features.commitRename(name, true)}
        >
          Preview · Ctrl+Enter
        </button>
      </div>
    </form>
  )
}

export function LspSignatureHelp({
  features,
  position,
}: {
  features: LspFeatures
  position: { left: number; top: number }
}) {
  const help = features.signature
  if (!help?.signatures.length) return null
  const active = help.activeSignature ?? 0
  const signature = help.signatures[active] ?? help.signatures[0]
  const parameter =
    signature.parameters?.[
      signature.activeParameter ?? help.activeParameter ?? 0
    ]
  const label = parameter?.label
  const start = Array.isArray(label)
    ? label[0]
    : typeof label === 'string'
      ? signature.label.indexOf(label)
      : -1
  const end = Array.isArray(label)
    ? label[1]
    : typeof label === 'string'
      ? start + label.length
      : -1
  const docs = parameter?.documentation ?? signature.documentation
  return (
    <div
      role="tooltip"
      aria-label="Signature help"
      className="fixed z-50 max-h-64 w-[min(36rem,calc(100vw-16px))] overflow-auto rounded border bg-popover p-3 text-popover-foreground shadow-lg"
      style={position}
    >
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {active + 1} / {help.signatures.length}
        </span>
        <span>
          <button
            aria-label="Previous signature"
            className="px-2"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => features.changeSignature(-1)}
          >
            ↑
          </button>
          <button
            aria-label="Next signature"
            className="px-2"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => features.changeSignature(1)}
          >
            ↓
          </button>
          <button
            aria-label="Close signature help"
            className="px-2"
            onClick={features.hideSignature}
          >
            ×
          </button>
        </span>
      </div>
      <pre className="overflow-x-auto whitespace-pre font-mono text-xs">
        {start >= 0 ? (
          <>
            <HighlightedCode>{signature.label.slice(0, start)}</HighlightedCode>
            <strong className="rounded bg-accent px-0.5">
              <HighlightedCode>
                {signature.label.slice(start, end)}
              </HighlightedCode>
            </strong>
            <HighlightedCode>{signature.label.slice(end)}</HighlightedCode>
          </>
        ) : (
          <HighlightedCode>{signature.label}</HighlightedCode>
        )}
      </pre>
      {docs ? (
        <div className="mt-2 border-t pt-2">
          <LspHover text={typeof docs === 'string' ? docs : docs.value} />
        </div>
      ) : null}
    </div>
  )
}
