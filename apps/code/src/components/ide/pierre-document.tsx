import * as React from 'react'
import { EditProvider, File, Virtualizer } from '@pierre/diffs/react'
import { getFiletypeFromFileName, preloadHighlighter } from '@pierre/diffs'
import { Editor } from '@pierre/diffs/edit'
import type { FileOptions, PostRenderPhase } from '@pierre/diffs'
import type { EditorFactory, Position } from '@pierre/diffs/edit'
import type {
  Diagnostic,
  FoldingRange,
  InlayHint,
} from 'vscode-languageserver-protocol'
import type { SemanticColor } from '~/lib/ide/semantic-tokens'
import { Spinner } from '~/components/ui/spinner'
import { birdsOfParadiseTheme } from '~/lib/birds-of-paradise-theme'

const MemoFile = React.memo(File<undefined, undefined>)
const emptySemanticTokens: Array<SemanticColor> = []
const emptyInlayHints: Array<InlayHint> = []
const emptyFoldingRanges: Array<FoldingRange> = []
const acceptEdit = () => 'accept' as const

const bracketPairs = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
])
const closingBrackets = new Set(bracketPairs.values())

function getTextOffsetAtPosition(
  text: string,
  position: { line: number; character: number },
) {
  const lineBreaks = /\r\n|\r|\n/g
  let offset = 0

  for (let line = 0; line < position.line; line++) {
    const lineBreak = lineBreaks.exec(text)
    if (!lineBreak) return text.length
    offset = lineBreak.index + lineBreak[0].length
    lineBreaks.lastIndex = offset
  }

  return Math.min(offset + position.character, text.length)
}

function getPositionAtTextOffset(text: string, offset: number) {
  const lines = text.slice(0, offset).split(/\r\n|\r|\n/)
  return {
    line: lines.length - 1,
    character: lines.at(-1)?.length ?? 0,
  }
}

export type PierreEditor = Editor<'file', undefined, undefined>
export function PierreDocument({
  active = true,
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
  semanticTokens = emptySemanticTokens,
  inlayHints = emptyInlayHints,
  foldingRanges = emptyFoldingRanges,
  focusPosition,
}: {
  active?: boolean
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
  const [editorAttached, setEditorAttached] = React.useState(false)
  const [error, setError] = React.useState('')
  const [hoveredLine, setHoveredLine] = React.useState<number | null>(null)
  const editorRef = React.useRef<PierreEditor | null>(null)
  const bracketInputListenerRef = React.useRef<{
    host: HTMLElement
    target: HTMLElement
    listener: (event: InputEvent) => void
  } | null>(null)
  const nativeChanges = React.useRef<Array<string>>([])
  const applyingExternal = React.useRef(false)
  const callbacks = React.useRef({
    active,
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
    active,
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
  const handleBracketInput = React.useCallback((event: InputEvent) => {
    const editor = editorRef.current
    const input = event.data
    if (
      !editor ||
      callbacks.current.readOnly ||
      event.isComposing ||
      event.inputType !== 'insertText' ||
      !input ||
      (bracketPairs.get(input) === undefined && !closingBrackets.has(input))
    ) {
      return
    }

    const text = editor.getText()
    const selections = editor.getViewState().selections ?? []
    if (selections.length === 0) return

    const selectionOffsets = selections.map((selection) => {
      const start = getTextOffsetAtPosition(text, selection.start)
      const end = getTextOffsetAtPosition(text, selection.end)
      return start === end ? start : null
    })
    if (selectionOffsets.some((offset) => offset === null)) return

    const offsets = selectionOffsets as Array<number>
    const uniqueOffsets = [...new Set(offsets)].sort(
      (left, right) => left - right,
    )
    let replacements: Array<{ offset: number; text: string }>

    if (bracketPairs.has(input)) {
      const closing = bracketPairs.get(input)
      replacements = uniqueOffsets.map((offset) => ({
        offset,
        text: text[offset] === closing ? input : input + closing,
      }))
    } else {
      if (!uniqueOffsets.some((offset) => text[offset] === input)) return
      replacements = uniqueOffsets
        .filter((offset) => text[offset] !== input)
        .map((offset) => ({ offset, text: input }))
    }

    event.preventDefault()
    event.stopImmediatePropagation()

    if (replacements.length > 0) {
      editor.applyEdits(
        replacements.map(({ offset, text: replacement }) => {
          const position = getPositionAtTextOffset(text, offset)
          return {
            range: { start: position, end: position },
            newText: replacement,
          }
        }),
      )
    }

    const updatedText = editor.getText()
    editor.setSelections(
      offsets.map((offset) => {
        const insertedBefore = replacements
          .filter((replacement) => replacement.offset < offset)
          .reduce((length, replacement) => length + replacement.text.length, 0)
        const position = getPositionAtTextOffset(
          updatedText,
          offset + insertedBefore + 1,
        )
        return { start: position, end: position, direction: 'none' }
      }),
    )
  }, [])

  const onFilePostRender = React.useCallback<
    NonNullable<FileOptions<undefined, undefined>['onPostRender']>
  >(
    (node, _instance, phase: PostRenderPhase) => {
      const attached = bracketInputListenerRef.current
      if (phase === 'unmount') {
        if (attached?.host === node) {
          attached.target.removeEventListener(
            'beforeinput',
            attached.listener,
            true,
          )
          bracketInputListenerRef.current = null
        }
        return
      }

      if (node.shadowRoot?.querySelector('[role="textbox"]'))
        setEditorAttached(true)
      const target =
        node.shadowRoot?.querySelector<HTMLElement>('[data-content]')
      if (!target || (attached?.host === node && attached.target === target)) {
        return
      }

      attached?.target.removeEventListener(
        'beforeinput',
        attached.listener,
        true,
      )
      target.addEventListener('beforeinput', handleBracketInput, true)
      bracketInputListenerRef.current = {
        host: node,
        target,
        listener: handleBracketInput,
      }
    },
    [handleBracketInput],
  )

  const initial = React.useRef({ name: path, contents })
  const createEditor = React.useCallback<EditorFactory<undefined, undefined>>(
    (type, options, key) => {
      const editor = new Editor(type, options, key)
      if (type === 'file') {
        editorRef.current = editor as PierreEditor
        if (callbacks.current.active)
          callbacks.current.onEditor(editor as PierreEditor)
      }
      return editor
    },
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
      matchBrackets: true,
      onAttach(editor: PierreEditor) {
        setEditorAttached(true)
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
        if (callbacks.current.active) callbacks.current.onEditor(editor)
        if (callbacks.current.active && callbacks.current.focusPosition)
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
    let live = true
    let frame = 0
    let mountTimer: ReturnType<typeof setTimeout> | undefined
    void preloadHighlighter({
      langs: [getFiletypeFromFileName(path)],
      themes: [birdsOfParadiseTheme],
      preferredHighlighter: 'shiki-js',
    })
      .then(() => {
        if (!live) return
        frame = requestAnimationFrame(() => {
          mountTimer = setTimeout(() => {
            if (live) setReady(true)
          }, 0)
        })
      })
      .catch((reason) => {
        if (live) setError(String(reason))
      })
    return () => {
      live = false
      cancelAnimationFrame(frame)
      clearTimeout(mountTimer)
      const attached = bracketInputListenerRef.current
      attached?.target.removeEventListener(
        'beforeinput',
        attached.listener,
        true,
      )
      bracketInputListenerRef.current = null
      editorRef.current = null
      if (callbacks.current.active) callbacks.current.onEditor(null)
    }
  }, [path])
  React.useEffect(() => {
    if (!active || !editorAttached) return
    const editor = editorRef.current
    if (!editor) return
    callbacks.current.onEditor(editor)
    reportPosition()
  }, [active, editorAttached])
  React.useEffect(() => {
    if (!active || !ready || !focusPosition) return
    const frame = window.setTimeout(() => {
      const editor = editorRef.current
      if (!editor) return
      if (callbacks.current.active) callbacks.current.onEditor(editor)
      editor.focus({
        lineNumber: focusPosition.line + 1,
        character: focusPosition.character,
      })
      callbacks.current.onPosition(focusPosition)
    })
    return () => window.clearTimeout(frame)
  }, [active, ready, focusPosition])
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
        onPostRender: onFilePostRender,
        theme: birdsOfParadiseTheme,
        themeType: 'dark',
        preferredHighlighter: 'shiki-js',
        disableFileHeader: true,
        disableLineNumbers: false,
        enableGutterUtility: true,
        unsafeCSS: `
          * { scrollbar-width: none; }
          *::-webkit-scrollbar { display: none; }
        `,
      }) satisfies FileOptions<undefined, undefined>,
    [onFilePostRender],
  )
  const lineAnnotations = React.useMemo(
    () =>
      Array.from(new Set(inlayHints.map((hint) => hint.position.line + 1))).map(
        (lineNumber) => ({ lineNumber }),
      ),
    [inlayHints],
  )
  const renderGutterUtility = React.useCallback(() => {
    const line = hoveredLine === null ? undefined : hoveredLine + 1
    if (
      line === undefined ||
      !foldingRanges.some((range) => range.startLine === line - 1)
    )
      return null
    return (
      <button
        aria-label={`Toggle fold at line ${line}`}
        onClick={() => {
          editorRef.current?.toggleFold(line - 1)
        }}
        className="px-1 text-xs"
      >
        ⌄
      </button>
    )
  }, [hoveredLine, foldingRanges])
  const renderAnnotation = React.useCallback<
    NonNullable<
      React.ComponentProps<
        typeof File<undefined, undefined>
      >['renderAnnotation']
    >
  >(
    (annotation) => (
      <div className="px-3 py-0.5 font-mono text-[11px] text-muted-foreground">
        {inlayHints
          .filter((hint) => hint.position.line + 1 === annotation.lineNumber)
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
    ),
    [inlayHints],
  )
  const fileStyle = React.useMemo(
    () =>
      ({
        '--diffs-font-family': 'var(--font-mono)',
        '--diffs-font-size': `${fontSize}px`,
        '--diffs-tab-size': tabSize,
      }) as React.CSSProperties,
    [fontSize, tabSize],
  )
  if (error)
    return (
      <p role="alert" className="p-4 text-destructive">
        {error}
      </p>
    )
  if (!ready)
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <Spinner aria-label="Loading editor" />
      </div>
    )
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      onKeyDownCapture={onCommand}
      onPointerMove={(event) => {
        const row = event.nativeEvent
          .composedPath()
          .find(
            (node): node is HTMLElement =>
              node instanceof HTMLElement &&
              (node.hasAttribute('data-line') ||
                node.hasAttribute('data-line-index')),
          )
        if (row)
          setHoveredLine(
            row.hasAttribute('data-line')
              ? Number(row.getAttribute('data-line')) - 1
              : Number(row.getAttribute('data-line-index')),
          )
      }}
      onPointerLeave={() => setHoveredLine(null)}
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
      {!editorAttached && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background">
          <Spinner aria-label="Loading editor" />
        </div>
      )}
      <Virtualizer
        className="min-h-0 flex-1 overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        contentClassName="min-h-full"
      >
        <EditProvider createEditor={createEditor}>
          <MemoFile
            file={initial.current}
            edit
            editStateKey={sessionKey}
            editorOptions={options}
            onEditComplete={acceptEdit}
            renderGutterUtility={renderGutterUtility}
            lineAnnotations={lineAnnotations}
            renderAnnotation={renderAnnotation}
            options={fileOptions}
            className="block min-h-full"
            style={fileStyle}
          />
        </EditProvider>
      </Virtualizer>
    </div>
  )
}
