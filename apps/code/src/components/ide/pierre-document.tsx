import * as React from 'react'
import { EditProvider, File } from '@pierre/diffs/react'
import { getFiletypeFromFileName, preloadHighlighter } from '@pierre/diffs'
import { Editor } from '@pierre/diffs/edit'
import type { FileOptions } from '@pierre/diffs'
import type { EditorFactory, Position } from '@pierre/diffs/edit'
import type {
  Diagnostic,
  FoldingRange,
  InlayHint,
} from 'vscode-languageserver-protocol'
import type { SemanticColor } from '~/lib/ide/semantic-tokens'
import { birdsOfParadiseTheme } from '~/lib/birds-of-paradise-theme'

export type PierreEditor = Editor<'file', undefined, undefined>
export function PierreDocument({
  path,
  contents,
  sessionKey,
  diagnostics,
  readOnly,
  onChange,
  onEditor,
  onPosition,
  onCommand,
  onNavigate,
  fontSize = 13,
  tabSize = 2,
  semanticTokens = [],
  inlayHints = [],
  foldingRanges = [],
  focusPosition,
}: {
  path: string
  contents: string
  sessionKey: string
  diagnostics: Array<Diagnostic>
  readOnly?: boolean
  onChange: (
    contents: string,
    changes?: Array<{ start: number; end: number; text: string }>,
  ) => void
  onEditor: (editor: PierreEditor | null) => void
  onPosition: (position: Position) => void
  onNavigate?: (position: Position) => void
  onCommand: (event: React.KeyboardEvent) => void
  fontSize?: number
  tabSize?: number
  semanticTokens?: Array<SemanticColor>
  inlayHints?: Array<InlayHint>
  foldingRanges?: Array<FoldingRange>
  focusPosition?: Position
}) {
  const [ready, setReady] = React.useState(false)
  const [error, setError] = React.useState('')
  const editorRef = React.useRef<PierreEditor | null>(null)
  const nativeChanges = React.useRef<Array<string>>([])
  const applyingExternal = React.useRef(false)
  const callbacks = React.useRef({
    onChange,
    onEditor,
    onPosition,
    diagnostics,
    contents,
    semanticTokens,
    readOnly,
    foldingRanges,
    focusPosition,
  })
  callbacks.current = {
    onChange,
    onEditor,
    onPosition,
    diagnostics,
    contents,
    semanticTokens,
    readOnly,
    foldingRanges,
    focusPosition,
  }
  const initial = React.useRef({ name: path, contents })
  const createEditor = React.useCallback<EditorFactory<undefined, undefined>>(
    (type, options, key) => new Editor(type, options, key),
    [],
  )
  const markers = (editor: PierreEditor, entries: Array<Diagnostic>) =>
    editor.setMarkers(
      entries.map((diagnostic) => ({
        ...diagnostic.range,
        message: diagnostic.message,
        source: diagnostic.source,
        severity:
          diagnostic.severity === 1
            ? 'error'
            : diagnostic.severity === 2
              ? 'warning'
              : diagnostic.severity === 4
                ? 'hint'
                : 'info',
      })),
    )
  const reportPosition = () => {
    const selection = editorRef.current?.getViewState().selections?.[0]
    if (selection)
      callbacks.current.onPosition(
        selection.direction === -1 ? selection.start : selection.end,
      )
  }
  const options = React.useMemo(
    () => ({
      onAttach(editor: PierreEditor) {
        editorRef.current = editor
        markers(editor, callbacks.current.diagnostics)
        if (editor.getText() !== callbacks.current.contents) {
          const lines = editor.getText().split('\n')
          editor.applyEdits([
            {
              range: {
                start: { line: 0, character: 0 },
                end: {
                  line: lines.length - 1,
                  character: lines[lines.length - 1].replace(/\r$/, '').length,
                },
              },
              newText: callbacks.current.contents,
            },
          ])
        }
        editor.setSemanticTokens(callbacks.current.semanticTokens)
        editor.setReadOnly(callbacks.current.readOnly ?? false)
        editor.setFoldingRanges(callbacks.current.foldingRanges)
        callbacks.current.onEditor(editor)
        if (callbacks.current.focusPosition)
          editor.focus({
            lineNumber: callbacks.current.focusPosition.line + 1,
            character: callbacks.current.focusPosition.character,
          })
      },
      onChange(event: {
        file: { contents: string }
        changes: Array<{ start: number; end: number; text: string }>
      }) {
        if (!applyingExternal.current) {
          nativeChanges.current.push(event.file.contents)
          if (nativeChanges.current.length > 128) nativeChanges.current.shift()
        }
        callbacks.current.onChange(event.file.contents, event.changes)
        reportPosition()
      },
      onSelectionChange(
        selections: Array<{
          start: Position
          end: Position
          direction: number
        }>,
      ) {
        const selection = selections.at(-1)
        if (selection)
          callbacks.current.onPosition(
            selection.direction === -1 ? selection.start : selection.end,
          )
      },
      ownsVerticalViewport: true,
    }),
    [],
  )
  React.useEffect(() => {
    let active = true
    void preloadHighlighter({
      langs: [getFiletypeFromFileName(path)],
      themes: [birdsOfParadiseTheme],
      preferredHighlighter: 'shiki-js',
    })
      .then(() => {
        if (active) setReady(true)
      })
      .catch((reason) => {
        if (active) setError(String(reason))
      })
    return () => {
      active = false
      callbacks.current.onEditor(null)
    }
  }, [path])
  React.useEffect(() => {
    if (!ready || !focusPosition) return
    const frame = window.setTimeout(() => {
      const editor = editorRef.current
      if (!editor) return
      callbacks.current.onEditor(editor)
      editor.focus({
        lineNumber: focusPosition.line + 1,
        character: focusPosition.character,
      })
      callbacks.current.onPosition(focusPosition)
    })
    return () => window.clearTimeout(frame)
  }, [ready, focusPosition])
  React.useEffect(() => {
    if (editorRef.current) markers(editorRef.current, diagnostics)
  }, [diagnostics])
  React.useEffect(() => {
    editorRef.current?.setSemanticTokens(semanticTokens)
  }, [semanticTokens])
  React.useEffect(() => {
    editorRef.current?.setReadOnly(readOnly ?? false)
  }, [readOnly])
  React.useEffect(() => {
    editorRef.current?.setFoldingRanges(foldingRanges)
  }, [foldingRanges])
  // External workspace edits join Pierre's existing undo timeline. User notifications never feed back into File props.
  React.useEffect(() => {
    const nativeIndex = nativeChanges.current.indexOf(contents)
    if (nativeIndex !== -1) {
      nativeChanges.current.splice(0, nativeIndex + 1)
      return
    }
    const editor = editorRef.current
    if (!editor || editor.getText() === contents) return
    const lines = editor.getText().split('\n')
    const last = lines[lines.length - 1].replace(/\r$/, '')
    applyingExternal.current = true
    try {
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: lines.length - 1, character: last.length },
          },
          newText: contents,
        },
      ])
    } finally {
      applyingExternal.current = false
    }
  }, [contents])
  const fileOptions = React.useMemo(
    () =>
      ({
        theme: birdsOfParadiseTheme,
        themeType: 'dark',
        preferredHighlighter: 'shiki-js',
        disableFileHeader: true,
        disableLineNumbers: false,
        enableGutterUtility: true,
      }) satisfies FileOptions<undefined, undefined>,
    [],
  )
  if (error)
    return (
      <p role="alert" className="p-4 text-destructive">
        {error}
      </p>
    )
  if (!ready)
    return <p className="p-4 text-muted-foreground">Preparing editor…</p>
  return (
    <div
      className="min-h-0 flex-1 overflow-auto"
      onKeyDownCapture={onCommand}
      onClickCapture={(event) => {
        if (!(event.ctrlKey || event.metaKey) || !onNavigate) return
        const root = event.nativeEvent
          .composedPath()
          .find((node) => node instanceof ShadowRoot)
        if (!root) return
        const point = (
          document as Document & {
            caretPositionFromPoint: (
              x: number,
              y: number,
              options: { shadowRoots: Array<ShadowRoot> },
            ) => { offsetNode: Node; offset: number } | null
          }
        ).caretPositionFromPoint(event.clientX, event.clientY, {
          shadowRoots: [root],
        })
        if (!point) return
        const element =
          point.offsetNode instanceof Element
            ? point.offsetNode
            : point.offsetNode.parentElement
        const line = element?.closest('[data-line]')
        if (!line || !root.querySelector('[role="textbox"]')?.contains(line))
          return
        const range = document.createRange()
        range.selectNodeContents(line)
        range.setEnd(point.offsetNode, point.offset)
        event.preventDefault()
        onNavigate({
          line: Number(line.getAttribute('data-line')) - 1,
          character: range.toString().length,
        })
      }}
    >
      <EditProvider createEditor={createEditor}>
        <File
          file={initial.current}
          edit
          editStateKey={sessionKey}
          editorOptions={options}
          onEditComplete={() => 'accept'}
          renderGutterUtility={(getHoveredLine) => {
            const line = getHoveredLine()?.lineNumber
            if (
              line === undefined ||
              !foldingRanges.some((range) => range.startLine === line - 1)
            )
              return null
            return (
              <button
                aria-label={`Toggle fold at line ${line}`}
                onClick={() => editorRef.current?.toggleFold(line - 1)}
                className="px-1 text-xs"
              >
                ⌄
              </button>
            )
          }}
          lineAnnotations={Array.from(
            new Set(inlayHints.map((hint) => hint.position.line + 1)),
          ).map((lineNumber) => ({ lineNumber }))}
          renderAnnotation={(annotation) => (
            <div className="px-3 py-0.5 font-mono text-[11px] text-muted-foreground">
              {inlayHints
                .filter(
                  (hint) => hint.position.line + 1 === annotation.lineNumber,
                )
                .map((hint, index) => (
                  <span key={index} className="mr-3">
                    {typeof hint.label === 'string'
                      ? hint.label
                      : hint.label.map((part) => part.value).join('')}{' '}
                    <span className="opacity-50">
                      col {hint.position.character + 1}
                    </span>
                  </span>
                ))}
            </div>
          )}
          options={fileOptions}
          className="block min-h-full"
          style={
            {
              '--diffs-font-family': 'var(--font-mono)',
              '--diffs-font-size': `${fontSize}px`,
              '--diffs-tab-size': tabSize,
            } as React.CSSProperties
          }
        />
      </EditProvider>
    </div>
  )
}
