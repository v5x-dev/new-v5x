import * as React from 'react'
import type {
  CompletionItem,
  CompletionList,
  Position,
} from 'vscode-languageserver-protocol'
import type { PierreEditor } from '~/components/ide/pierre-document'
import type { ClangdClient } from '~/lib/ide/clangd-client'
import {
  completionEdits,
  normalizeCompletions,
  shouldTriggerCompletion,
} from '~/lib/ide/language-features'
import { offsetPosition, type SnippetStop } from '~/lib/ide/snippets'
import {
  fileUri,
  positionOffset,
  type Documents,
  type WorkspaceDocument,
} from '~/lib/ide/workspace'

const AUTO_COMPLETE_DELAY = 180

interface Options {
  clientRef: { current: ClangdClient | null }
  editorRef: { current: PierreEditor | null }
  documentsRef: { current: Documents }
  selectedFileRef: { current: string }
  ready: boolean
  selected: WorkspaceDocument | undefined
  // The last known caret, used when Pierre has no selection.
  position: Position
  run: (task: () => Promise<void>) => Promise<void>
}

const cursorOf = (selection: {
  start: Position
  end: Position
  direction?: unknown
}) => (selection.direction === -1 ? selection.start : selection.end)

// clangd completions for the selected document, including snippet tab stops
// after an accepted completion.
export function useCompletions({
  clientRef,
  editorRef,
  documentsRef,
  selectedFileRef,
  ready,
  selected,
  position,
  run,
}: Options) {
  const [completions, setCompletions] = React.useState<Array<CompletionItem>>(
    [],
  )
  const [completionIndex, setCompletionIndex] = React.useState(0)

  // Where the visible completions were requested.
  const contextRef = React.useRef<{
    path: string
    version: number
    position: Position
  } | null>(null)

  const snippetRef = React.useRef<{
    path: string
    stops: Array<SnippetStop>
    index: number
  } | null>(null)

  const suppressRef = React.useRef(false)
  const abortRef = React.useRef<AbortController | null>(null)
  const positionRef = React.useRef(position)
  positionRef.current = position

  const clear = React.useCallback(
    () => setCompletions((current) => (current.length ? [] : current)),
    [],
  )

  const getAnchor = React.useCallback(() => {
    const current = contextRef.current
    return current
      ? editorRef.current?.getPositionRect(current.position)
      : undefined
  }, [])

  const complete = async () => {
    const client = clientRef.current
    const doc = documentsRef.current[selectedFileRef.current]
    const editor = editorRef.current
    if (!client?.ready || !doc || !editor) return

    const selection = editor.getViewState().selections?.at(-1)
    const cursor = selection ? cursorOf(selection) : positionRef.current

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    let result: CompletionList | Array<CompletionItem> | null

    try {
      result = await client.request<
        CompletionList | Array<CompletionItem> | null
      >(
        'textDocument/completion',
        {
          textDocument: { uri: fileUri(doc.path) },
          position: cursor,
          context: { triggerKind: 1 },
        },
        controller.signal,
      )
    } catch (error) {
      if (controller.signal.aborted) return
      throw error
    }

    if (controller.signal.aborted) return

    if (
      selectedFileRef.current !== doc.path ||
      documentsRef.current[doc.path]?.version !== doc.version
    )
      return

    // Drop the result when the caret moved while clangd was working.
    const currentSelection = editor.getViewState().selections?.at(-1)
    const currentCursor = currentSelection && cursorOf(currentSelection)

    if (
      !currentCursor ||
      currentCursor.line !== cursor.line ||
      currentCursor.character !== cursor.character
    )
      return

    contextRef.current = {
      path: doc.path,
      version: doc.version,
      position: cursor,
    }
    setCompletions(normalizeCompletions(result))
    setCompletionIndex(0)
  }

  const selectStop = (index: number) => {
    const session = snippetRef.current
    const stop = session?.stops[index]
    const editor = editorRef.current

    if (!session || !stop || !editor) {
      snippetRef.current = null
      return
    }

    session.index = index
    const text = documentsRef.current[session.path]?.contents ?? ''

    editor.setSelections(
      session.stops
        .filter((entry) => entry.index === stop.index)
        .map((entry) => ({
          start: offsetPosition(text, entry.start),
          end: offsetPosition(text, entry.end),
          direction: 'forward',
        })),
    )

    editor.focus()
    // Stop 0 is the final caret position and ends the snippet.
    if (!stop.index) snippetRef.current = null
  }

  const accept = async (item: CompletionItem) => {
    const at = contextRef.current
    const client = clientRef.current
    const editor = editorRef.current

    if (!at || !client || !editor || at.path !== selectedFileRef.current) return

    const resolved = client.capabilities.completionProvider?.resolveProvider
      ? await client.request<CompletionItem>('completionItem/resolve', item)
      : item

    const doc = documentsRef.current[at.path]

    if (!doc || doc.version !== at.version) {
      setCompletions([])
      return
    }

    const { edits, stops } = completionEdits(resolved, doc, at.position)

    suppressRef.current = true
    editor.applyEdits(edits)
    setCompletions([])

    if (stops.length) {
      snippetRef.current = { path: at.path, stops, index: 0 }
      selectStop(0)
    } else editor.focus()
  }

  // Moves between snippet stops. Returns false when no snippet is active.
  const nextStop = (backwards: boolean) => {
    const session = snippetRef.current
    if (!session) return false
    selectStop(session.index + (backwards ? -1 : 1))
    return true
  }

  const reset = React.useCallback(() => {
    setCompletions([])
    snippetRef.current = null
  }, [])

  // Pierre reports text changes with the ranges they replaced.
  const remapSnippet = (
    remap: (stops: Array<SnippetStop>) => Array<SnippetStop>,
  ) => {
    if (snippetRef.current)
      snippetRef.current.stops = remap(snippetRef.current.stops)
  }

  // Requests completions after typing an identifier, `.`, `->` or `::`.
  React.useEffect(() => {
    if (!ready || !selected || suppressRef.current) {
      suppressRef.current = false
      return
    }

    const timer = setTimeout(() => {
      const doc = documentsRef.current[selectedFileRef.current]
      const selection = editorRef.current?.getViewState().selections?.at(-1)
      if (!doc || !selection) return

      const offset = positionOffset(doc.contents, cursorOf(selection))
      if (shouldTriggerCompletion(doc.contents, offset)) void run(complete)
    }, AUTO_COMPLETE_DELAY)

    return () => {
      clearTimeout(timer)
      abortRef.current?.abort()
    }
  }, [selected?.version, ready])

  return {
    completions,
    completionIndex,
    setCompletionIndex,
    contextRef,
    getAnchor,
    clear,
    reset,
    complete,
    accept,
    nextStop,
    remapSnippet,
  }
}
