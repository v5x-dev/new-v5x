import * as React from 'react'
import { createPortal } from 'react-dom'
import {
  Editor,
  type EditorFactory,
  type Marker,
  type Position,
} from '@pierre/diffs/edit'
import { EditProvider, File, type FileProps } from '@pierre/diffs/react'
import type {
  LanguageServerClient,
  LspCompletionItem,
  LspDiagnostic,
  LspLocation,
} from '~/lib/language-server-client'
import { programPathToUri } from '~/lib/language-server-client'

type PopupPosition = { left: number; top: number }
const isSourceFile = (path: string) =>
  /\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(path)
const markerSeverities = ['error', 'warning', 'info', 'hint'] as const

export function LspFile({
  client,
  status,
  retry,
  onNavigate,
  initialPosition,
  onNavigationComplete,
  ...props
}: FileProps<undefined, undefined> & {
  client: LanguageServerClient | null
  status: string
  retry: () => void
  onNavigate: (path: string, position: Position) => boolean
  initialPosition?: Position
  onNavigationComplete: () => void
}) {
  const editorRef = React.useRef<Editor | null>(null)
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const [diagnostics, setDiagnostics] = React.useState<LspDiagnostic[]>([])
  const [completions, setCompletions] = React.useState<LspCompletionItem[]>([])
  const [selectedCompletion, setSelectedCompletion] = React.useState(0)
  const [popupPosition, setPopupPosition] = React.useState<PopupPosition>({
    left: 0,
    top: 0,
  })
  const [hover, setHover] = React.useState<{
    text: string
    position: PopupPosition
  } | null>(null)
  const [references, setReferences] = React.useState<LspLocation[]>([])
  const [navigationMessage, setNavigationMessage] = React.useState('')
  const completionPositionRef = React.useRef<Position | null>(null)
  const requestVersionRef = React.useRef(0)
  const hoverVersionRef = React.useRef(0)
  const supported = isSourceFile(props.file.name)

  React.useEffect(() => {
    if (!initialPosition) return
    const frame = requestAnimationFrame(() => {
      editorRef.current?.focus({
        lineNumber: initialPosition.line + 1,
        character: initialPosition.character,
      })
      onNavigationComplete()
    })
    return () => cancelAnimationFrame(frame)
  }, [initialPosition, onNavigationComplete])

  const createEditor = React.useMemo<EditorFactory<undefined, undefined>>(
    () => (type, options, key) =>
      new Editor(
        type,
        {
          ...options,
          onAttach(editor, instance) {
            editorRef.current = editor
            options.onAttach?.(editor, instance)
          },
        },
        key,
      ),
    [],
  )

  React.useEffect(() => {
    setDiagnostics([])
    if (!client || !supported) return
    const path = props.file.name
    const unsubscribe = client.onDiagnostics((uri, items) => {
      if (uri !== programPathToUri(path)) return
      setDiagnostics(items)
      if (editorRef.current?.getEditState())
        editorRef.current.setMarkers(
          items.map((item): Marker => ({
            ...item.range,
            message: item.message,
            source: item.source,
            severity: markerSeverities[(item.severity ?? 1) - 1],
          })),
        )
    })
    client.openDocument(
      path,
      editorRef.current?.getText() ?? props.file.contents,
    )
    return () => {
      unsubscribe()
      client.closeDocument(path)
      if (editorRef.current?.getEditState()) editorRef.current.setMarkers([])
      editorRef.current = null
      requestVersionRef.current++
      hoverVersionRef.current++
    }
  }, [client, props.file.name, supported])

  const requestCompletions = React.useCallback(async () => {
    const editor = editorRef.current
    const selection = editor?.getViewState().selections?.[0]
    if (!client || !editor || !selection || !supported) return
    const position =
      selection.direction === -1 ? selection.start : selection.end
    const version = ++requestVersionRef.current
    const text = editor.getText()
    completionPositionRef.current = position
    try {
      const items = await client.completion(props.file.name, position)
      const current = editor.getViewState().selections?.[0]
      const cursor = current?.direction === -1 ? current.start : current?.end
      if (
        version !== requestVersionRef.current ||
        editor.getText() !== text ||
        cursor?.line !== position.line ||
        cursor.character !== position.character
      )
        return
      setCompletions(items.slice(0, 100))
      setSelectedCompletion(0)
      const host = wrapperRef.current?.querySelector('diffs-container')
      const caret = host?.shadowRoot?.querySelector('[data-caret]')
      const bounds = (caret ?? wrapperRef.current)?.getBoundingClientRect()
      if (bounds)
        setPopupPosition({
          left: Math.max(8, Math.min(bounds.left, window.innerWidth - 392)),
          top:
            bounds.bottom + 264 < window.innerHeight
              ? bounds.bottom + 4
              : Math.max(8, bounds.top - 260),
        })
    } catch {
      setCompletions([])
    }
  }, [client, props.file.name, supported])

  const applyCompletion = (item: LspCompletionItem) => {
    const editor = editorRef.current
    const position = completionPositionRef.current
    if (!editor || !position) return
    const line = editor.getText().split(/\r?\n/)[position.line] ?? ''
    const prefix = /[\w~]*$/.exec(line.slice(0, position.character))?.[0] ?? ''
    const edit = item.textEdit ?? {
      range: {
        start: {
          line: position.line,
          character: position.character - prefix.length,
        },
        end: position,
      },
      newText: item.insertText ?? item.label,
    }
    editor.applyEdits([...(item.additionalTextEdits ?? []), edit])
    setCompletions([])
    requestVersionRef.current++
    editor.focus()
  }

  const navigateLocation = React.useCallback(
    (location: LspLocation) => {
      if (!location.uri.startsWith('file:///workspace/')) {
        setNavigationMessage('Definition is in the SDK')
        return
      }
      const path = decodeURIComponent(
        location.uri.slice('file:///workspace/'.length),
      )
      if (path === props.file.name) {
        editorRef.current?.focus({
          lineNumber: location.range.start.line + 1,
          character: location.range.start.character,
        })
      } else if (!onNavigate(path, location.range.start)) {
        setNavigationMessage('Could not open this definition')
      }
      setReferences([])
    },
    [onNavigate, props.file.name],
  )

  const findDefinition = React.useCallback(
    async (position: Position) => {
      if (!client || !supported) return
      try {
        const result = await client.definition(props.file.name, position)
        const location = Array.isArray(result) ? result[0] : result
        if (location) navigateLocation(location)
        else setNavigationMessage('No definition found')
      } catch {
        setNavigationMessage('Could not find the definition')
      }
    },
    [client, props.file.name, supported, navigateLocation],
  )

  const options = React.useMemo(
    () => ({
      ...props.options,
      unsafeCSS: `${props.options?.unsafeCSS ?? ''}
        [data-marker-popover][data-editor-widget] {
          font-family: var(--font-mono, monospace) !important;
        }
      `,
      onTokenClick(
        token: { lineNumber: number; lineCharStart: number },
        event: MouseEvent,
      ) {
        if (event.ctrlKey || event.metaKey)
          void findDefinition({
            line: token.lineNumber - 1,
            character: token.lineCharStart,
          })
      },
      onTokenEnter(token: {
        lineNumber: number
        lineCharStart: number
        lineCharEnd: number
        tokenElement: HTMLElement
      }) {
        if (!client || !supported) return
        const line = token.lineNumber - 1
        if (
          diagnostics.some(
            ({ range }) =>
              line >= range.start.line &&
              line <= range.end.line &&
              (line !== range.start.line ||
                token.lineCharEnd > range.start.character) &&
              (line !== range.end.line ||
                token.lineCharStart < range.end.character),
          )
        )
          return
        const version = ++hoverVersionRef.current
        const bounds = token.tokenElement.getBoundingClientRect()
        void client
          .hover(props.file.name, {
            line: token.lineNumber - 1,
            character: token.lineCharStart,
          })
          .then((result) => {
            if (version !== hoverVersionRef.current || !result) return
            const contents = (result as { contents?: unknown }).contents
            const text = hoverText(contents)
            if (text)
              setHover({
                text,
                position: {
                  left: Math.min(bounds.left, window.innerWidth - 480),
                  top: Math.min(bounds.bottom + 6, window.innerHeight - 220),
                },
              })
          })
          .catch(() => {})
      },
      onTokenLeave() {
        hoverVersionRef.current++
        setHover(null)
      },
    }),
    [
      client,
      props.file.name,
      props.options,
      supported,
      findDefinition,
      diagnostics,
    ],
  )

  return (
    <EditProvider createEditor={createEditor}>
      <div
        ref={wrapperRef}
        className="relative flex h-full min-h-0 flex-col"
        onKeyDownCapture={(event) => {
          if (event.key === 'F12' && client && supported) {
            event.preventDefault()
            event.stopPropagation()
            const selection = editorRef.current?.getViewState().selections?.[0]
            const position =
              selection?.direction === -1 ? selection.start : selection?.end
            if (!position) return
            if (!event.shiftKey) void findDefinition(position)
            else
              void client
                .references(props.file.name, position, true)
                .then((items) => {
                  setReferences(items ?? [])
                  const bounds = wrapperRef.current?.getBoundingClientRect()
                  if (bounds)
                    setPopupPosition({
                      left: bounds.left + 40,
                      top: bounds.top + 40,
                    })
                  if (!items?.length)
                    setNavigationMessage('No references found')
                })
                .catch(() => setNavigationMessage('Could not find references'))
            return
          }
          if (event.key === 'Escape' && references.length) {
            event.preventDefault()
            event.stopPropagation()
            setReferences([])
            return
          }
          if (event.ctrlKey && event.code === 'Space') {
            event.preventDefault()
            event.stopPropagation()
            void requestCompletions()
            return
          }
          if (!completions.length) return
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setCompletions([])
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            setSelectedCompletion(
              (index) =>
                (index +
                  (event.key === 'ArrowDown' ? 1 : completions.length - 1)) %
                completions.length,
            )
          } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            event.stopPropagation()
            applyCompletion(completions[selectedCompletion])
          } else {
            requestVersionRef.current++
            setCompletions([])
          }
        }}
      >
        <File
          {...props}
          options={options}
          onEditChange={(event) => {
            props.onEditChange?.(event)
            if (client && supported)
              client.changeDocument(props.file.name, event.file.contents)
            requestVersionRef.current++
            setCompletions([])
            setHover(null)
            setNavigationMessage('')
            setReferences([])
            const inserted = event.changes.at(-1)?.text
            if (inserted === '.' || inserted === '>' || inserted === ':')
              queueMicrotask(() => void requestCompletions())
          }}
        />
        <div
          className="flex shrink-0 items-center gap-3 border-t px-3 py-1.5 text-xs text-muted-foreground"
          role="status"
        >
          <span>{status}</span>
          {navigationMessage ? <span>{navigationMessage}</span> : null}
          {client && supported ? (
            <>
              <span>
                {diagnostics.length}{' '}
                {diagnostics.length === 1 ? 'problem' : 'problems'}
              </span>
              <button
                className="ml-auto hover:text-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void requestCompletions()}
              >
                Complete · Ctrl+Space
              </button>
            </>
          ) : null}
          {!client && !status.startsWith('Starting') ? (
            <button className="ml-auto hover:text-foreground" onClick={retry}>
              Retry
            </button>
          ) : null}
        </div>
        {completions.length
          ? createPortal(
              <div
                role="listbox"
                aria-label="Code completions"
                className="fixed z-50 max-h-64 w-96 max-w-[calc(100vw-16px)] overflow-auto rounded-md border bg-popover p-1 font-mono text-xs shadow-lg"
                style={popupPosition}
              >
                {completions.map((item, index) => (
                  <button
                    key={`${item.label}-${index}`}
                    role="option"
                    aria-selected={index === selectedCompletion}
                    className={`block w-full rounded px-2 py-1 text-left ${index === selectedCompletion ? 'bg-accent text-accent-foreground' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyCompletion(item)}
                  >
                    <span>{item.label}</span>
                    {item.detail ? (
                      <span className="ml-3 text-muted-foreground">
                        {item.detail}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>,
              document.body,
            )
          : null}
        {hover && !completions.length
          ? createPortal(
              <div
                className="pointer-events-none fixed z-50 max-h-52 max-w-lg overflow-hidden whitespace-pre-wrap rounded-md border bg-popover p-3 font-mono text-xs shadow-lg"
                style={hover.position}
              >
                {hover.text}
              </div>,
              document.body,
            )
          : null}
        {references.length
          ? createPortal(
              <div
                role="dialog"
                aria-label="Symbol references"
                className="fixed z-50 max-h-64 w-96 overflow-auto rounded-md border bg-popover p-2 text-xs shadow-lg"
                style={popupPosition}
              >
                <p className="mb-1 font-medium">References · Escape to close</p>
                {references.map((location, index) => (
                  <button
                    key={index}
                    className="block w-full rounded p-1 text-left font-mono hover:bg-accent"
                    onClick={() => navigateLocation(location)}
                  >
                    {decodeURIComponent(
                      location.uri.replace('file:///workspace/', ''),
                    )}
                    :{location.range.start.line + 1}
                  </button>
                ))}
              </div>,
              document.body,
            )
          : null}
      </div>
    </EditProvider>
  )
}

function hoverText(contents: unknown): string {
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map(hoverText).join('\n\n')
  if (
    typeof contents === 'object' &&
    contents !== null &&
    'value' in contents &&
    typeof contents.value === 'string'
  ) {
    return contents.value
      .replace(/```[^\n]*\n?/g, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^---+\s*$/gm, '')
      .replace(/`([^`]+)`/g, '$1')
      .trim()
  }
  return ''
}
