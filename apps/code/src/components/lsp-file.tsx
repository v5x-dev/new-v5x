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
import { LspHover } from './lsp-hover'
import { LspSdkDefinition } from './lsp-sdk-definition'
import { cppSymbolAt } from '~/lib/cpp-symbol'
import { useLspFeatures } from '~/lib/use-lsp-features'
import {
  completionKinds,
  completionPrefix,
  filterCompletions,
  parseSnippet,
  SnippetSession,
} from '~/lib/lsp-completion'
import { textOffset } from '~/lib/lsp-workspace'
import { decoratePierre, lspDecorationCSS } from '~/lib/pierre-lsp-decorations'
import { LspFeatureDialogs, LspSignatureHelp } from './lsp-features-ui'

type PopupPosition = { left: number; top: number }
const isSourceFile = (path: string) =>
  /\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(path)
const markerSeverities = ['error', 'warning', 'info', 'hint'] as const

export function LspFile({
  client,
  onNavigate,
  initialPosition,
  onNavigationComplete,
  ...props
}: FileProps<undefined, undefined> & {
  client: LanguageServerClient | null
  onNavigate: (path: string, position: Position) => boolean
  initialPosition?: Position
  onNavigationComplete: () => void
}) {
  const editorRef = React.useRef<Editor | null>(null)
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const [diagnostics, setDiagnostics] = React.useState<LspDiagnostic[]>([])
  const [completions, setCompletions] = React.useState<LspCompletionItem[]>([])
  const [selectedCompletion, setSelectedCompletion] = React.useState(0)
  const [completionDetails, setCompletionDetails] =
    React.useState<LspCompletionItem | null>(null)
  const [folded, setFolded] = React.useState<Set<number>>(new Set())
  const [popupPosition, setPopupPosition] = React.useState<PopupPosition>({
    left: 0,
    top: 0,
  })
  const [hover, setHover] = React.useState<{
    text: string
    position: PopupPosition
  } | null>(null)
  const [navigationMessage, setNavigationMessage] = React.useState('')
  const [sdkDefinition, setSdkDefinition] = React.useState<{
    location: LspLocation | null
    contents: string | null
    error?: string
  } | null>(null)
  const navigationVersionRef = React.useRef(0)
  const completionTextRef = React.useRef('')
  const completionPositionRef = React.useRef<Position | null>(null)
  const completionAbortRef = React.useRef<AbortController | null>(null)
  const hoverAbortRef = React.useRef<AbortController | null>(null)
  const snippetRef = React.useRef<SnippetSession | null>(null)
  const completionItemsRef = React.useRef<LspCompletionItem[]>([])
  const applyingCompletionRef = React.useRef(false)
  const requestVersionRef = React.useRef(0)
  const hoverVersionRef = React.useRef(0)
  const hoverOpenTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const hoverCloseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const supported = isSourceFile(props.file.name)

  const cancelHoverOpen = React.useCallback(() => {
    hoverAbortRef.current?.abort()
    if (hoverOpenTimerRef.current !== null) {
      clearTimeout(hoverOpenTimerRef.current)
      hoverOpenTimerRef.current = null
    }
  }, [])

  const cancelHoverClose = React.useCallback(() => {
    if (hoverCloseTimerRef.current !== null) {
      clearTimeout(hoverCloseTimerRef.current)
      hoverCloseTimerRef.current = null
    }
  }, [])

  const scheduleHoverClose = React.useCallback(() => {
    cancelHoverClose()
    // Match VS Code's default editor.hover.hidingDelay for sticky hovers.
    hoverCloseTimerRef.current = setTimeout(() => {
      hoverCloseTimerRef.current = null
      setHover(null)
    }, 300)
  }, [cancelHoverClose])

  React.useEffect(() => {
    setHover(null)
    setSdkDefinition(null)
    navigationVersionRef.current++
    return () => {
      navigationVersionRef.current++
      cancelHoverOpen()
      cancelHoverClose()
      hoverVersionRef.current++
    }
  }, [client, props.file.name, cancelHoverClose, cancelHoverOpen])

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
            message:
              typeof item.message === 'string'
                ? item.message
                : item.message.value,
            source: item.source,
            severity: markerSeverities[(item.severity ?? 1) - 1],
          })),
        )
    })
    client.openDocument(
      path,
      editorRef.current?.getText() ?? props.file.contents,
    )
    const detach = editorRef.current
      ? client.workspace.attach(path, editorRef.current)
      : () => {}
    return () => {
      detach()
      unsubscribe()
      client.closeDocument(path)
      if (editorRef.current?.getEditState()) editorRef.current.setMarkers([])
      requestVersionRef.current++
      hoverVersionRef.current++
      completionAbortRef.current?.abort()
    }
  }, [client, props.file.name, supported])

  React.useEffect(() => {
    const item = completions[selectedCompletion]
    setCompletionDetails(item ?? null)
    if (!client || !item) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void client
        .resolveCompletion(item, controller.signal)
        .then((resolved) => {
          if (!controller.signal.aborted) setCompletionDetails(resolved)
        })
        .catch(() => {})
    }, 80)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [client, completions, selectedCompletion])

  const requestCompletions = React.useCallback(
    async (trigger?: string) => {
      const editor = editorRef.current
      const selection = editor?.getViewState().selections?.[0]
      if (!client || !editor || !selection || !supported) return
      const position =
        selection.direction === -1 ? selection.start : selection.end
      const version = ++requestVersionRef.current
      const text = editor.getText()
      completionAbortRef.current?.abort()
      const controller = new AbortController()
      completionAbortRef.current = controller
      try {
        const isTrigger =
          trigger &&
          client.capabilities.completionProvider?.triggerCharacters?.includes(
            trigger,
          )
        const items = await client.completion(
          props.file.name,
          position,
          {
            triggerKind: isTrigger ? 2 : 1,
            ...(isTrigger ? { triggerCharacter: trigger } : {}),
          },
          controller.signal,
        )
        const current = editor.getViewState().selections?.[0]
        const cursor = current?.direction === -1 ? current.start : current?.end
        if (
          version !== requestVersionRef.current ||
          editor.getText() !== text ||
          cursor?.line !== position.line ||
          cursor.character !== position.character
        )
          return
        completionTextRef.current = text
        completionPositionRef.current = position
        completionItemsRef.current = items
        const filtered = filterCompletions(
          items,
          completionPrefix(text, position),
        ).slice(0, 100)
        setCompletions(filtered)
        setSelectedCompletion(
          Math.max(
            0,
            filtered.findIndex((item) => item.preselect),
          ),
        )
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
        if (version === requestVersionRef.current) setCompletions([])
      }
    },
    [client, props.file.name, supported],
  )

  const applyCompletion = async (
    selectedItem: LspCompletionItem,
    commitCharacter?: string,
  ) => {
    const editor = editorRef.current
    const selection = editor?.getViewState().selections?.[0]
    const position =
      selection?.direction === -1 ? selection.start : selection?.end
    if (!editor || !position) return
    let item = selectedItem
    // A visible list can outlive its response while the next prefix is queried.
    // Refresh before applying so clangd's edit ranges match the current text.
    if (
      editor.getText() !== completionTextRef.current ||
      position.line !== completionPositionRef.current?.line ||
      position.character !== completionPositionRef.current?.character
    ) {
      if (!client) return
      const text = editor.getText()
      const version = requestVersionRef.current
      try {
        const items = await client.completion(props.file.name, position)
        const selection = editor.getViewState().selections?.[0]
        const cursor =
          selection?.direction === -1 ? selection.start : selection?.end
        if (
          editor.getText() !== text ||
          version !== requestVersionRef.current ||
          cursor?.line !== position.line ||
          cursor.character !== position.character
        )
          return
        const current = items.find(
          (candidate) => candidate.label === selectedItem.label,
        )
        if (!current) return
        item = current
      } catch {
        return
      }
    }
    const snapshot = editor.getText()
    if (client) {
      try {
        item = await client.resolveCompletion(item)
      } catch {
        /* Use the original item when resolution is unavailable. */
      }
      const current = editor.getViewState().selections?.[0]
      const cursor = current?.direction === -1 ? current.start : current?.end
      if (
        editor.getText() !== snapshot ||
        cursor?.line !== position.line ||
        cursor?.character !== position.character
      )
        return
    }
    const line = editor.getText().split(/\r?\n/)[position.line] ?? ''
    const prefix = /[\w~]*$/.exec(line.slice(0, position.character))?.[0] ?? ''
    const edit = {
      ...(item.textEdit ?? {
        range: {
          start: {
            line: position.line,
            character: position.character - prefix.length,
          },
          end: position,
        },
        newText: item.insertText ?? item.label,
      }),
    }
    const parsed =
      item.insertTextFormat === 2
        ? parseSnippet(edit.newText, {
            TM_FILENAME: props.file.name.split('/').at(-1) ?? props.file.name,
            TM_FILEPATH: `/workspace/${props.file.name}`,
            TM_DIRECTORY: `/workspace/${props.file.name.split('/').slice(0, -1).join('/')}`,
            TM_CURRENT_LINE: line,
            TM_LINE_INDEX: String(position.line),
            TM_LINE_NUMBER: String(position.line + 1),
          })
        : { text: edit.newText, stops: [] }
    edit.newText = parsed.text
    // LSP kinds 2 and 3 are methods and functions.
    const isFunction = item.kind === 2 || item.kind === 3
    let cursorOffset: number | undefined
    if (isFunction) {
      const text = editor.getText()
      const lines = text.split('\n')
      const offsetAt = (point: Position) =>
        lines
          .slice(0, point.line)
          .reduce((sum, line) => sum + line.length + 1, 0) + point.character
      const start = offsetAt(edit.range.start)
      const end = offsetAt(edit.range.end)
      const statement = /^\s*(?:[a-zA-Z_]\w*(?:::|\.|->))*$/.test(
        line.slice(0, edit.range.start.character),
      )
      const suffix = text.slice(end)
      const appendSemicolon =
        statement && (!suffix.trimStart() || /^\s*(?:\r?\n|;)/.test(suffix))
      const opening = edit.newText.indexOf('(')
      if (opening >= 0) {
        if (edit.newText.endsWith(')') && text[end] !== ';' && appendSemicolon)
          edit.newText += ';'
        cursorOffset = start + opening + 1
      } else if (text[end] === '(') {
        cursorOffset = start + edit.newText.length + 1
      } else {
        cursorOffset = start + edit.newText.length + 1
        edit.newText += text[end] === ';' || !appendSemicolon ? '()' : '();'
      }
      for (const additional of item.additionalTextEdits ?? []) {
        if (offsetAt(additional.range.end) <= start) {
          cursorOffset +=
            additional.newText.length -
            (offsetAt(additional.range.end) - offsetAt(additional.range.start))
        }
      }
    }
    if (
      commitCharacter &&
      commitCharacter !== '(' &&
      !edit.newText.endsWith(commitCharacter)
    ) {
      edit.newText += commitCharacter
      cursorOffset = undefined
      parsed.stops = []
    }
    if (parsed.stops.length)
      for (const stop of parsed.stops) {
        if (stop.index === 0 && stop.start === parsed.text.length)
          stop.start = stop.end = edit.newText.length
      }
    let base = textOffset(snapshot, edit.range.start)
    for (const additional of item.additionalTextEdits ?? [])
      if (textOffset(snapshot, additional.range.end) <= base)
        base +=
          additional.newText.length -
          (textOffset(snapshot, additional.range.end) -
            textOffset(snapshot, additional.range.start))
    snippetRef.current = null
    applyingCompletionRef.current = true
    try {
      editor.applyEdits([...(item.additionalTextEdits ?? []), edit])
    } finally {
      applyingCompletionRef.current = false
    }
    setCompletions([])
    requestVersionRef.current++
    if (parsed.stops.some((stop) => stop.index !== 0)) {
      const session = new SnippetSession(editor, parsed.stops, base)
      snippetRef.current = session.select() ? session : null
    } else if (cursorOffset !== undefined) {
      const beforeCursor = editor.getText().slice(0, cursorOffset).split('\n')
      editor.focus({
        lineNumber: beforeCursor.length,
        character: beforeCursor.at(-1)?.length ?? 0,
      })
    } else editor.focus()
    if (item.command && client)
      void client.execute(item.command).catch(features.fail)
    features.afterEdit('(')
  }

  const navigateLocation = React.useCallback(
    (location: LspLocation) => {
      const version = ++navigationVersionRef.current
      if (!location.uri.startsWith('file:///workspace/')) {
        if (!client) return
        setSdkDefinition({ location, contents: null })
        void client
          .readSdkFile(location.uri)
          .then((contents) => {
            if (version !== navigationVersionRef.current) return
            setSdkDefinition({ location, contents })
            setNavigationMessage('')
          })
          .catch(() => {
            if (version === navigationVersionRef.current)
              setSdkDefinition({
                location,
                contents: null,
                error: 'Could not open SDK definition',
              })
          })
        return
      }
      setSdkDefinition(null)
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
    },
    [client, onNavigate, props.file.name],
  )

  const features = useLspFeatures({
    client,
    path: props.file.name,
    editorRef,
    onNavigate: navigateLocation,
  })
  const applyDecorations = React.useCallback(
    (host: HTMLElement) => {
      const provider = client?.capabilities.semanticTokensProvider
      decoratePierre(
        host,
        features.decorations,
        typeof provider === 'object' ? provider.legend : undefined,
        folded,
      )
    },
    [client, features.decorations, folded],
  )
  const foldAtCursor = () => {
    const position = editorRef.current?.getViewState().selections?.[0]?.start
    if (!position) return
    const range = features.decorations.folds
      .filter(
        (range) =>
          range.startLine <= position.line && range.endLine >= position.line,
      )
      .sort((a, b) => b.startLine - a.startLine)[0]
    if (range) setFolded((previous) => new Set([...previous, range.startLine]))
  }

  React.useEffect(() => {
    const host =
      wrapperRef.current?.querySelector<HTMLElement>('diffs-container')
    if (host) applyDecorations(host)
  }, [applyDecorations])
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const changed = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const host = wrapperRef.current?.querySelector('diffs-container')
        const anchor = window.getSelection()?.anchorNode
        if (!anchor || anchor.getRootNode() !== host?.shadowRoot) return
        const position =
          editorRef.current?.getViewState().selections?.[0]?.start
        if (position)
          setFolded((previous) => {
            const next = new Set(previous)
            for (const fold of features.decorations.folds)
              if (
                position.line > fold.startLine &&
                position.line <= fold.endLine
              )
                next.delete(fold.startLine)
            return next.size === previous.size ? previous : next
          })
        features.refresh()
      }, 120)
    }
    document.addEventListener('selectionchange', changed)
    return () => {
      document.removeEventListener('selectionchange', changed)
      if (timer) clearTimeout(timer)
    }
  }, [features.refresh, features.decorations.folds])

  const findDefinition = React.useCallback(
    async (position: Position) => {
      if (!client || !supported) return
      const symbol = cppSymbolAt(
        editorRef.current?.getText() ?? props.file.contents,
        position,
      )
      if (!symbol) return
      const version = ++navigationVersionRef.current
      setSdkDefinition({ location: null, contents: null })
      try {
        const result = await client.definition(props.file.name, symbol)
        if (version !== navigationVersionRef.current) return
        const location = Array.isArray(result) ? result[0] : result
        if (result.length > 1) {
          setSdkDefinition(null)
          features.showLocations('Definitions', result)
        } else if (location) features.navigate(location)
        else
          setSdkDefinition({
            location: null,
            contents: null,
            error: 'No definition found',
          })
      } catch {
        if (version === navigationVersionRef.current)
          setSdkDefinition({
            location: null,
            contents: null,
            error: 'Could not find the definition',
          })
      }
    },
    [
      client,
      props.file.name,
      props.file.contents,
      supported,
      features.navigate,
      features.showLocations,
    ],
  )

  const options = React.useMemo(
    () => ({
      ...props.options,
      onPostRender(
        node: HTMLElement,
        instance: Parameters<
          NonNullable<NonNullable<typeof props.options>['onPostRender']>
        >[1],
        phase: Parameters<
          NonNullable<NonNullable<typeof props.options>['onPostRender']>
        >[2],
      ) {
        props.options?.onPostRender?.(node, instance, phase)
        if (phase !== 'unmount') applyDecorations(node)
      },
      enableGutterUtility: client?.supports('foldingRange') ?? false,
      renderGutterUtility(getLine: () => { lineNumber: number } | undefined) {
        const startLine = (getLine()?.lineNumber ?? 0) - 1
        const fold = features.decorations.folds.find(
          (range) => range.startLine === startLine,
        )
        const button = document.createElement('button')
        button.textContent = fold ? (folded.has(startLine) ? '▸' : '▾') : ''
        button.title = folded.has(startLine) ? 'Unfold' : 'Fold'
        button.setAttribute('aria-label', button.title)
        button.onclick = (event) => {
          event.preventDefault()
          event.stopPropagation()
          const startLine = (getLine()?.lineNumber ?? 0) - 1
          if (
            !features.decorations.folds.some(
              (range) => range.startLine === startLine,
            )
          )
            return
          setFolded((previous) => {
            const next = new Set(previous)
            if (next.has(startLine)) next.delete(startLine)
            else next.add(startLine)
            return next
          })
        }
        return button
      },
      unsafeCSS: `${props.options?.unsafeCSS ?? ''}
        ${lspDecorationCSS}
        [data-marker-popover][data-editor-widget] {
          font-family: var(--font-mono, monospace) !important;
        }
        :host([data-definition-modifier]) [data-definition-symbol]:hover {
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 3px;
        }
      `,
      onTokenEnter(token: {
        lineNumber: number
        lineCharStart: number
        lineCharEnd: number
        tokenElement: HTMLElement
      }) {
        token.tokenElement.toggleAttribute(
          'data-definition-symbol',
          !!cppSymbolAt(editorRef.current?.getText() ?? props.file.contents, {
            line: token.lineNumber - 1,
            character: token.lineCharStart,
          }),
        )
        if (!client || !supported) return
        cancelHoverOpen()
        const version = ++hoverVersionRef.current
        cancelHoverClose()
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
        ) {
          scheduleHoverClose()
          return
        }
        const bounds = token.tokenElement.getBoundingClientRect()
        hoverOpenTimerRef.current = setTimeout(() => {
          hoverOpenTimerRef.current = null
          if (version !== hoverVersionRef.current) return
          const controller = new AbortController()
          hoverAbortRef.current = controller
          void client
            .hover(
              props.file.name,
              {
                line: token.lineNumber - 1,
                character: token.lineCharStart,
              },
              controller.signal,
            )
            .then((result) => {
              if (version !== hoverVersionRef.current) return
              if (!result) {
                scheduleHoverClose()
                return
              }
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
              else scheduleHoverClose()
            })
            .catch(() => {
              if (version === hoverVersionRef.current) scheduleHoverClose()
            })
        }, 300)
      },
      onTokenLeave() {
        cancelHoverOpen()
        hoverVersionRef.current++
        scheduleHoverClose()
      },
    }),
    [
      client,
      props.file.name,
      props.options,
      props.file.contents,
      applyDecorations,
      features.decorations.folds,
      folded,
      supported,
      findDefinition,
      diagnostics,
      cancelHoverClose,
      cancelHoverOpen,
      scheduleHoverClose,
    ],
  )

  return (
    <EditProvider createEditor={createEditor}>
      <div
        ref={wrapperRef}
        className="relative flex h-full min-h-0 flex-col"
        onPointerDownCapture={(event) => {
          if (
            !(event.ctrlKey || event.metaKey) ||
            event.button !== 0 ||
            !client ||
            !supported
          )
            return
          const path = event.nativeEvent.composedPath()
          const token = path.find(
            (node) =>
              node instanceof HTMLElement && node.hasAttribute('data-char'),
          ) as HTMLElement | undefined
          const row = path.find(
            (node) =>
              node instanceof HTMLElement && node.hasAttribute('data-line'),
          ) as HTMLElement | undefined
          if (!token || !row) return
          if (
            !cppSymbolAt(editorRef.current?.getText() ?? props.file.contents, {
              line:
                Number.parseInt(row.getAttribute('data-line') ?? '', 10) - 1,
              character: Number.parseInt(
                token.getAttribute('data-char') ?? '',
                10,
              ),
            })
          )
            return
          // Pierre adds cursors on pointerdown, before our definition click handler.
          event.preventDefault()
          event.stopPropagation()
        }}
        onPointerMoveCapture={(event) => {
          wrapperRef.current
            ?.querySelector('diffs-container')
            ?.toggleAttribute(
              'data-definition-modifier',
              event.ctrlKey || event.metaKey,
            )
        }}
        onKeyUpCapture={(event) => {
          wrapperRef.current
            ?.querySelector('diffs-container')
            ?.toggleAttribute(
              'data-definition-modifier',
              event.ctrlKey || event.metaKey,
            )
        }}
        onClickCapture={(event) => {
          if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return
          const path = event.nativeEvent.composedPath()
          const token = path.find(
            (node) =>
              node instanceof HTMLElement && node.hasAttribute('data-char'),
          ) as HTMLElement | undefined
          const row = path.find(
            (node) =>
              node instanceof HTMLElement && node.hasAttribute('data-line'),
          ) as HTMLElement | undefined
          if (!token || !row || !client || !supported) return
          const line =
            Number.parseInt(row.getAttribute('data-line') ?? '', 10) - 1
          const character = Number.parseInt(
            token.getAttribute('data-char') ?? '',
            10,
          )
          if (!Number.isFinite(line) || !Number.isFinite(character)) return
          if (
            !cppSymbolAt(editorRef.current?.getText() ?? props.file.contents, {
              line,
              character,
            })
          )
            return
          event.preventDefault()
          event.stopPropagation()
          cancelHoverOpen()
          cancelHoverClose()
          hoverVersionRef.current++
          setHover(null)
          setCompletions([])
          requestVersionRef.current++
          void findDefinition({ line, character })
        }}
        onKeyDownCapture={(event) => {
          wrapperRef.current
            ?.querySelector('diffs-container')
            ?.toggleAttribute(
              'data-definition-modifier',
              event.ctrlKey || event.metaKey,
            )
          if (
            event.nativeEvent.isComposing ||
            (event.target instanceof HTMLElement &&
              event.target.closest('dialog'))
          )
            return
          const modifier = event.ctrlKey || event.metaKey
          let command: (() => void | Promise<unknown>) | undefined
          if (client && supported) {
            if (event.key === 'F12')
              command = event.shiftKey
                ? features.showReferences
                : event.altKey
                  ? () => features.navigation('definition', true)
                  : modifier
                    ? () => features.navigation('implementation')
                    : () => {
                        const selection =
                          editorRef.current?.getViewState().selections?.[0]
                        const position =
                          selection?.direction === -1
                            ? selection.start
                            : selection?.end
                        if (position) return findDefinition(position)
                      }
            else if (event.key === 'F2' && client.supports('rename'))
              command = features.showRename
            else if (event.key === 'F8')
              command = () => features.nextProblem(event.shiftKey)
            else if (
              event.shiftKey &&
              event.altKey &&
              event.key.toLowerCase() === 'f'
            )
              command = () => features.format()
            else if (
              modifier &&
              event.shiftKey &&
              event.key.toLowerCase() === 'r'
            )
              command = () => features.showActions(['refactor'])
            else if (
              modifier &&
              event.shiftKey &&
              event.key.toLowerCase() === 'o'
            )
              command = features.showSymbols
            else if (modifier && event.key.toLowerCase() === 't')
              command = () => features.showWorkspaceSymbols()
            else if (
              modifier &&
              event.shiftKey &&
              event.key.toLowerCase() === 'm'
            )
              command = features.showProblems
            else if (
              event.shiftKey &&
              event.altKey &&
              event.key.toLowerCase() === 'h'
            )
              command = () => features.showCallHierarchy()
            else if (
              event.shiftKey &&
              event.altKey &&
              event.key === 'ArrowRight'
            )
              command = () => features.expandSelection()
            else if (
              event.shiftKey &&
              event.altKey &&
              event.key === 'ArrowLeft'
            )
              command = () => features.expandSelection(true)
            else if (event.altKey && event.key === 'ArrowLeft')
              command = () => features.goHistory(-1)
            else if (event.altKey && event.key === 'ArrowRight')
              command = () => features.goHistory(1)
            else if (modifier && event.shiftKey && event.code === 'BracketLeft')
              command = foldAtCursor
            else if (
              modifier &&
              event.shiftKey &&
              event.code === 'BracketRight'
            )
              command = () => setFolded(new Set())
            else if (event.ctrlKey && event.shiftKey && event.code === 'Space')
              command = () => features.requestSignature(undefined, true)
            else if (event.ctrlKey && event.code === 'Space')
              command = () => requestCompletions()
          }
          if (command) {
            event.preventDefault()
            event.stopPropagation()
            void Promise.resolve(command()).catch(features.fail)
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            completionAbortRef.current?.abort()
            requestVersionRef.current++
            setCompletions([])
            cancelHoverOpen()
            setHover(null)
            features.hideSignature()
            snippetRef.current = null
            return
          }
          if (snippetRef.current && !snippetRef.current.containsCursor())
            snippetRef.current = null
          if (
            event.key === 'Tab' &&
            snippetRef.current &&
            !completions.length
          ) {
            event.preventDefault()
            event.stopPropagation()
            if (!snippetRef.current.move(event.shiftKey))
              snippetRef.current = null
            return
          }
          if (
            !completions.length &&
            features.signature &&
            (event.key === 'ArrowUp' || event.key === 'ArrowDown')
          ) {
            event.preventDefault()
            event.stopPropagation()
            features.changeSignature(event.key === 'ArrowDown' ? 1 : -1)
            return
          }
          if (
            completions[selectedCompletion]?.commitCharacters?.includes(
              event.key,
            ) &&
            !modifier &&
            !event.altKey
          ) {
            event.preventDefault()
            event.stopPropagation()
            void applyCompletion(completions[selectedCompletion], event.key)
            return
          }
          if (!completions.length) return
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            requestVersionRef.current++
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
            void applyCompletion(completions[selectedCompletion])
          } else {
            const continuesWord =
              (!event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                event.key.length === 1 &&
                /[\w~]/.test(event.key)) ||
              event.key === 'Backspace' ||
              event.key === 'Delete' ||
              event.key === 'Shift'
            if (!continuesWord) {
              requestVersionRef.current++
              setCompletions([])
            }
          }
        }}
      >
        <div className="min-h-0 flex-1 overflow-auto">
          <File
            {...props}
            options={options}
            onEditChange={(event) => {
              snippetRef.current?.update(event.changes, event.file.contents)
              setFolded(new Set())
              props.onEditChange?.(event)
              if (client && supported)
                client.changeDocument(props.file.name, event.file.contents)
              requestVersionRef.current++
              completionAbortRef.current?.abort()
              cancelHoverOpen()
              setHover(null)
              setNavigationMessage('')
              if (applyingCompletionRef.current) {
                setCompletions([])
                return
              }
              queueMicrotask(() => {
                features.afterEdit(event.changes.at(-1)?.text)
                const editor = editorRef.current
                const selection = editor?.getViewState().selections?.[0]
                const position =
                  selection?.direction === -1 ? selection.start : selection?.end
                const line = position
                  ? editor
                      ?.getText()
                      .split(/\r?\n/)
                      [position.line]?.slice(0, position.character)
                  : undefined
                const member = /(?:\.|->|::)([\w~]*)$/.exec(line ?? '')
                const identifier = /[a-zA-Z_][\w]*$/.exec(line ?? '')
                const symbol =
                  position &&
                  cppSymbolAt(editor?.getText() ?? '', {
                    ...position,
                    character: Math.max(
                      0,
                      position.character -
                        (member?.[1].length
                          ? member[1].length
                          : (identifier?.[0].length ?? 1)),
                    ),
                  })
                if (
                  (member || identifier) &&
                  (symbol ||
                    (member &&
                      cppSymbolAt(editor?.getText() ?? '', {
                        ...position!,
                        character: Math.max(
                          0,
                          position!.character - member[0].length - 1,
                        ),
                      })))
                ) {
                  const prefix = (
                    member?.[1] ??
                    identifier?.[0] ??
                    ''
                  ).toLowerCase()
                  setCompletions(
                    filterCompletions(completionItemsRef.current, prefix).slice(
                      0,
                      100,
                    ),
                  )
                  setSelectedCompletion(0)
                  void requestCompletions(event.changes.at(-1)?.text.at(-1))
                } else setCompletions([])
              })
            }}
          />
        </div>
        {navigationMessage ? (
          <div
            role="alert"
            className="absolute bottom-3 left-3 z-40 rounded border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
          >
            {navigationMessage}
          </div>
        ) : null}
        {features.notice ? (
          <div
            role="alert"
            className="flex shrink-0 items-center gap-2 border-t px-3 py-2 text-xs"
          >
            <span
              className={
                features.notice.type === 1
                  ? 'text-destructive'
                  : 'text-muted-foreground'
              }
            >
              {features.notice.message}
            </span>
            {features.notice.actions?.map((action) => (
              <button
                key={action.title}
                className="rounded border px-2 py-1"
                onClick={() => {
                  features.notice?.respond?.(action)
                  features.dismissNotice()
                }}
              >
                {action.title}
              </button>
            ))}
            <button
              className="ml-auto"
              onClick={features.dismissNotice}
              aria-label="Dismiss message"
            >
              ×
            </button>
          </div>
        ) : null}
        {features.progress.size ? (
          <div
            role="status"
            className="flex shrink-0 gap-3 border-t px-3 py-1 text-xs text-muted-foreground"
          >
            {[...features.progress].map(([token, value]) => (
              <span key={token}>
                {value.title} {value.message}{' '}
                {value.percentage === undefined ? '' : `${value.percentage}%`}{' '}
                {value.cancellable ? (
                  <button onClick={() => client?.cancelProgress(token)}>
                    Cancel
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
        {createPortal(
          <LspFeatureDialogs features={features} options={props.options} />,
          document.body,
        )}
        {features.signature
          ? createPortal(
              <LspSignatureHelp
                features={features}
                position={{
                  left: Math.max(
                    8,
                    Math.min(
                      wrapperRef.current?.getBoundingClientRect().left ?? 8,
                      window.innerWidth - 584,
                    ),
                  ),
                  top: Math.max(
                    8,
                    (wrapperRef.current
                      ?.querySelector('diffs-container')
                      ?.shadowRoot?.querySelector('[data-caret]')
                      ?.getBoundingClientRect().top ?? 200) - 200,
                  ),
                }}
              />,
              document.body,
            )
          : null}
        {completions.length
          ? createPortal(
              <div
                className="fixed z-50 flex max-h-72 w-[min(48rem,calc(100vw-16px))] flex-col overflow-hidden rounded-md border bg-popover text-xs shadow-lg sm:flex-row"
                style={{
                  ...popupPosition,
                  left: Math.max(
                    8,
                    Math.min(popupPosition.left, window.innerWidth - 776),
                  ),
                }}
              >
                <div
                  role="listbox"
                  aria-label="Code completions"
                  className="max-h-72 min-w-0 flex-1 overflow-auto p-1 font-mono"
                >
                  {completions.map((item, index) => (
                    <button
                      key={`${item.label}-${index}`}
                      role="option"
                      aria-selected={index === selectedCompletion}
                      className={`block w-full rounded px-2 py-1 text-left ${index === selectedCompletion ? 'bg-accent text-accent-foreground' : ''}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void applyCompletion(item)}
                    >
                      <span
                        className="mr-2 inline-block min-w-6 text-[10px] text-muted-foreground"
                        title={completionKinds[item.kind ?? 1]}
                      >
                        {['method', 'function', 'constructor'].includes(
                          completionKinds[item.kind ?? 1],
                        )
                          ? 'ƒ'
                          : ['class', 'struct', 'type parameter'].includes(
                                completionKinds[item.kind ?? 1],
                              )
                            ? 'T'
                            : item.kind === 6
                              ? 'v'
                              : item.kind === 5
                                ? '·'
                                : '◇'}
                      </span>
                      <span
                        className={
                          item.deprecated || item.tags?.includes(1)
                            ? 'line-through opacity-60'
                            : ''
                        }
                      >
                        {item.label}
                      </span>
                      {item.labelDetails?.detail ? (
                        <span className="text-muted-foreground">
                          {item.labelDetails.detail}
                        </span>
                      ) : null}
                      {item.detail ? (
                        <span className="ml-3 text-muted-foreground">
                          {item.detail}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                {completionDetails?.documentation ||
                completionDetails?.detail ? (
                  <aside
                    aria-label="Completion documentation"
                    className="max-h-72 min-w-0 flex-1 overflow-auto border-t p-3 sm:border-l sm:border-t-0"
                  >
                    {completionDetails.detail ? (
                      <LspHover
                        text={`\`\`\`cpp\n${completionDetails.detail}\n\`\`\``}
                      />
                    ) : null}
                    {completionDetails.documentation ? (
                      <div className="mt-2">
                        <LspHover
                          text={
                            typeof completionDetails.documentation === 'string'
                              ? completionDetails.documentation
                              : completionDetails.documentation.value
                          }
                        />
                      </div>
                    ) : null}
                  </aside>
                ) : null}
              </div>,
              document.body,
            )
          : null}
        {hover && !completions.length
          ? createPortal(
              <div
                role="tooltip"
                aria-label="Symbol documentation"
                tabIndex={0}
                onMouseEnter={() => {
                  cancelHoverClose()
                  cancelHoverOpen()
                  hoverVersionRef.current++
                }}
                onMouseLeave={scheduleHoverClose}
                onFocus={() => {
                  cancelHoverClose()
                  cancelHoverOpen()
                  hoverVersionRef.current++
                }}
                onBlur={scheduleHoverClose}
                className="pointer-events-auto fixed z-50 max-h-80 w-max max-w-[min(36rem,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-md border bg-popover p-3 shadow-xl"
                style={hover.position}
              >
                <LspHover text={hover.text} />
              </div>,
              document.body,
            )
          : null}
        {sdkDefinition
          ? createPortal(
              <LspSdkDefinition
                key={sdkDefinition.location?.uri ?? 'loading'}
                {...sdkDefinition}
                options={props.options}
                onClose={() => {
                  navigationVersionRef.current++
                  setSdkDefinition(null)
                  editorRef.current?.focus()
                }}
              />,
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
    if ('language' in contents && typeof contents.language === 'string')
      return `\`\`\`${contents.language}\n${contents.value}\n\`\`\``
    return contents.value.trim()
  }
  return ''
}
