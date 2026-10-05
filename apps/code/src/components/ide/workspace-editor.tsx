import * as React from 'react'
import { PierreDocument } from './pierre-document'
import type { PierreEditor } from './pierre-document'
import type {
  CompletionItem,
  CompletionList,
  Diagnostic,
  DocumentSymbol,
  FoldingRange,
  Location,
  LocationLink,
  Position,
  SemanticTokens,
  SymbolInformation,
  TextEdit,
} from 'vscode-languageserver-protocol'
import type { ProjectTemplate } from '~/lib/ide/compile-commands'
import type { Documents } from '~/lib/ide/workspace'
import type { SemanticColor } from '~/lib/ide/semantic-tokens'
import type { SnippetStop } from '~/lib/ide/snippets'
import { decodeSemanticTokens } from '~/lib/ide/semantic-tokens'
import { ClangdClient } from '~/lib/ide/clangd-client'
import { symbolFoldingRanges } from '~/lib/ide/folding'
import { compileCommands } from '~/lib/ide/compile-commands'
import {
  applyTextEdits,
  fileUri,
  isDirty,
  positionOffset,
  recoverDocuments,
  updateDocument,
  uriPath,
  workspaceDocuments,
} from '~/lib/ide/workspace'
import {
  expandSnippet,
  offsetPosition,
  remapSnippetStops,
} from '~/lib/ide/snippets'
import { readWorkspace, writeWorkspace } from '~/lib/ide/persistence'

export interface ProjectSnapshot {
  files: Record<string, string>
  commitSha: string
}
export interface CommitChange {
  path: string
  contents: string | null
}
interface Props {
  workspaceId: string
  template: ProjectTemplate
  selectedFile: string
  commitSha?: string
  loadSnapshot: () => Promise<ProjectSnapshot>
  commitChanges: (
    changes: Array<CommitChange>,
    expectedCommitSha: string,
    message: string,
  ) => Promise<string>
  onSelect: (path: string) => void
  onPathsChange: (paths: Array<string>) => void
  onDirtyChange: (dirty: boolean) => void
  onSavingChange: (saving: boolean) => void
  buildOutput?: string
  saveHandlerRef: { current: (() => Promise<void>) | null }
}
const emptyDiagnostics: Array<Diagnostic> = []
export function WorkspaceEditor(props: Props) {
  const propsRef = React.useRef(props)
  propsRef.current = props
  const [documents, setDocuments] = React.useState<Documents>({})
  const documentsRef = React.useRef(documents)
  const commitRef = React.useRef('')
  const conflictsRef = React.useRef<Array<string>>([])
  const [conflicts, setConflicts] = React.useState<Array<string>>([])
  const [analysis, setAnalysis] = React.useState<{
    path: string
    version: number
    tokens: Array<SemanticColor>
    folds: Array<FoldingRange>
  } | null>(null)
  const clientRef = React.useRef<ClangdClient | null>(null)
  const editorRef = React.useRef<PierreEditor | null>(null)
  const [ready, setReady] = React.useState(false)
  const [editorRevision, setEditorRevision] = React.useState(0)
  const [error, setError] = React.useState('')
  const [diagnostics, setDiagnostics] = React.useState<
    Record<string, Array<Diagnostic>>
  >({})
  const [position, setPosition] = React.useState<Position>({
    line: 0,
    character: 0,
  })
  const [target, setTarget] = React.useState<{
    path: string
    position: Position
  } | null>(null)
  const [sdkHeader, setSdkHeader] = React.useState<{
    path: string
    contents: string
  } | null>(null)
  const [completions, setCompletions] = React.useState<Array<CompletionItem>>(
    [],
  )
  const [completionIndex, setCompletionIndex] = React.useState(0)
  const context = React.useRef<{
    path: string
    version: number
    position: Position
  } | null>(null)
  const [anchor, setAnchor] = React.useState({ left: 12, top: 12 })
  const snippet = React.useRef<{
    path: string
    stops: Array<SnippetStop>
    index: number
  } | null>(null)
  const saving = React.useRef(false)
  const suppressCompletion = React.useRef(false)
  const selected = documents[props.selectedFile]
  const publish = (next: Documents) => {
    documentsRef.current = next
    setDocuments(next)
  }
  const run = async (task: () => Promise<void>) => {
    try {
      setError('')
      await task()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  React.useEffect(() => {
    let active = true
    setReady(false)
    setAnalysis(null)
    const isActive = () => active
    const client = new ClangdClient({
      status: () => {},
      error: (reason) => {
        if (active) setError(reason.message)
      },
      applyEdit: () =>
        Promise.reject(
          new Error('Server-requested workspace edits are disabled'),
        ),
      diagnostics: (uri, entries, version) => {
        if (!isActive()) return
        const path = uriPath(uri)
        if (
          version !== undefined &&
          documentsRef.current[path]?.version !== version
        )
          return
        setDiagnostics((old) => ({ ...old, [path]: entries }))
      },
    })
    clientRef.current = client
    void run(async () => {
      const cached = await readWorkspace(props.workspaceId)
      const loaded = await propsRef.current
        .loadSnapshot()
        .then((remote) => ({
          commitSha: remote.commitSha,
          recovered: recoverDocuments(remote.files, cached),
        }))
        .catch((reason) => {
          if (!cached) throw reason
          return {
            commitSha: cached.commitSha,
            recovered: {
              documents: cached.documents,
              conflicts: cached.conflicts ?? [],
            },
          }
        })
      if (!isActive()) return
      const recovered = loaded.recovered
      const next = recovered.documents
      conflictsRef.current = recovered.conflicts
      setConflicts(recovered.conflicts)
      commitRef.current = loaded.commitSha
      publish(next)
      const files = Object.fromEntries(
        workspaceDocuments(next)
          .filter((doc) => !doc.deleted)
          .map((doc) => [doc.path, doc.contents]),
      )
      const response = await fetch('/language/sdk-manifest.json')
      if (!response.ok) throw new Error('Language SDK manifest is missing')
      const manifest = (await response.json()) as { gccVersion: string }
      if (!isActive()) return
      await client.start(
        files,
        props.template,
        compileCommands(files, props.template, manifest.gccVersion),
        props.workspaceId,
      )
      if (isActive()) setReady(true)
    })
    return () => {
      active = false
      client.stop()
    }
  }, [props.workspaceId])

  React.useEffect(() => {
    if (!ready) return
    for (const doc of workspaceDocuments(documents)) {
      if (doc.deleted) {
        clientRef.current?.remove(doc.path)
        continue
      }
      if (
        /\.(c|cc|cpp|cxx)$/.test(doc.path) ||
        (/\.(h|hpp|hxx)$/.test(doc.path) &&
          (doc.path === props.selectedFile || isDirty(doc)))
      )
        clientRef.current?.sync(doc.path, doc.contents, doc.version)
      else clientRef.current?.setFile(doc.path, doc.contents, doc.version)
    }
  }, [documents, props.selectedFile, ready])
  React.useEffect(() => {
    setAnalysis(null)
    const client = clientRef.current
    if (
      !ready ||
      !client?.ready ||
      !selected ||
      selected.deleted ||
      sdkHeader ||
      !/\.(c|cc|cpp|cxx|h|hpp|hxx)$/.test(selected.path)
    )
      return
    const controller = new AbortController()
    const { path, version } = selected
    const params = { textDocument: { uri: fileUri(path) } }
    const timer = setTimeout(() => {
      const provider = client.capabilities.semanticTokensProvider
      const tokens =
        provider && provider.full
          ? client
              .request<SemanticTokens | null>(
                'textDocument/semanticTokens/full',
                params,
                controller.signal,
              )
              .then((result) =>
                result ? decodeSemanticTokens(result, provider.legend) : [],
              )
          : Promise.resolve([])
      const folds = client.capabilities.foldingRangeProvider
        ? client
            .request<Array<FoldingRange> | null>(
              'textDocument/foldingRange',
              params,
              controller.signal,
            )
            .then((result) => result ?? [])
        : client.capabilities.documentSymbolProvider
          ? client
              .request<Array<DocumentSymbol> | Array<SymbolInformation> | null>(
                'textDocument/documentSymbol',
                params,
                controller.signal,
              )
              .then((symbols) => symbolFoldingRanges(symbols ?? []))
          : Promise.resolve([])
      void Promise.all([tokens, folds])
        .then(([colors, ranges]) => {
          if (
            !controller.signal.aborted &&
            documentsRef.current[path]?.version === version
          )
            setAnalysis({ path, version, tokens: colors, folds: ranges })
        })
        .catch((reason) => {
          if (!controller.signal.aborted) setError(String(reason))
        })
    }, 180)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [ready, selected?.path, selected?.version, sdkHeader])
  React.useEffect(() => {
    props.onDirtyChange(workspaceDocuments(documents).some(isDirty))
    if (Object.keys(documents).length)
      props.onPathsChange(Object.keys(documents).sort())
    if (!commitRef.current) return
    const timer = setTimeout(() => {
      void writeWorkspace(props.workspaceId, {
        documents,
        conflicts,
        commitSha: commitRef.current,
        tabs: [],
        selectedFile: props.selectedFile,
        template: props.template,
      }).catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [documents, props.selectedFile, conflicts])
  React.useEffect(() => {
    setSdkHeader(null)
    setCompletions([])
    snippet.current = null
  }, [props.selectedFile])
  React.useEffect(() => {
    const save = async () => {
      if (saving.current) return
      if (conflictsRef.current.length)
        throw new Error('Review recovered drafts before committing.')
      const changed = workspaceDocuments(documentsRef.current).filter(isDirty)
      if (!changed.length) return
      saving.current = true
      propsRef.current.onSavingChange(true)
      try {
        const sha = await propsRef.current.commitChanges(
          changed.map((doc) => ({
            path: doc.path,
            contents: doc.deleted ? null : doc.contents,
          })),
          commitRef.current,
          'Update project',
        )
        commitRef.current = sha
        const next = { ...documentsRef.current }
        for (const doc of changed)
          if (doc.deleted) delete next[doc.path]
          else if (next[doc.path])
            next[doc.path] = { ...next[doc.path]!, baseline: doc.contents }
        publish(next)
      } finally {
        saving.current = false
        propsRef.current.onSavingChange(false)
      }
    }
    props.saveHandlerRef.current = save
    return () => {
      props.saveHandlerRef.current = null
    }
  }, [])

  const complete = async () => {
    const client = clientRef.current,
      doc = documentsRef.current[propsRef.current.selectedFile]
    if (!client?.ready || !doc || !editorRef.current) return
    const selection = editorRef.current.getViewState().selections?.at(-1)
    const cursor = selection
      ? selection.direction === -1
        ? selection.start
        : selection.end
      : position
    const result = await client.request<
      CompletionList | Array<CompletionItem> | null
    >('textDocument/completion', {
      textDocument: { uri: fileUri(doc.path) },
      position: cursor,
      context: { triggerKind: 1 },
    })
    if (
      propsRef.current.selectedFile !== doc.path ||
      documentsRef.current[doc.path]?.version !== doc.version
    )
      return
    context.current = { path: doc.path, version: doc.version, position: cursor }
    setCompletions(
      (Array.isArray(result) ? result : (result?.items ?? []))
        .sort((a, b) =>
          (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label),
        )
        .slice(0, 100),
    )
    setCompletionIndex(0)
    const rect = editorRef.current.getPositionRect(cursor)
    if (rect)
      setAnchor({
        left: Math.max(0, Math.min(rect.left, window.innerWidth - 400)),
        top: Math.max(0, Math.min(rect.bottom + 4, window.innerHeight - 300)),
      })
  }
  React.useEffect(() => {
    if (!ready || !selected || suppressCompletion.current) {
      suppressCompletion.current = false
      return
    }
    const prefix = selected.contents.slice(
      0,
      positionOffset(selected.contents, position),
    )
    if (!/(?:[A-Za-z_]\w{1,}|\.|->|::)$/.test(prefix)) return
    const timer = setTimeout(() => void run(complete), 180)
    return () => clearTimeout(timer)
  }, [selected?.version, ready])
  const selectStop = (index: number) => {
    const session = snippet.current,
      stop = session?.stops[index],
      editor = editorRef.current
    if (!session || !stop || !editor) {
      snippet.current = null
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
    if (!stop.index) snippet.current = null
  }
  const accept = async (item: CompletionItem) => {
    const at = context.current,
      client = clientRef.current,
      editor = editorRef.current
    if (!at || !client || !editor || at.path !== propsRef.current.selectedFile)
      return
    let resolved = item
    if (client.capabilities.completionProvider?.resolveProvider)
      resolved = await client.request<CompletionItem>(
        'completionItem/resolve',
        item,
      )
    const doc = documentsRef.current[at.path]
    if (!doc || doc.version !== at.version) {
      setCompletions([])
      return
    }
    const edit = resolved.textEdit
    const primary: TextEdit = edit
      ? 'range' in edit
        ? edit
        : { range: edit.replace, newText: edit.newText }
      : {
          range: { start: at.position, end: at.position },
          newText: resolved.insertText ?? resolved.label,
        }
    const expanded =
      resolved.insertTextFormat === 2
        ? expandSnippet(primary.newText, at.path)
        : null
    if (expanded) primary.newText = expanded.text
    const edits = [primary, ...(resolved.additionalTextEdits ?? [])]
    applyTextEdits(doc.contents, edits)
    let start = positionOffset(doc.contents, primary.range.start)
    for (const additional of resolved.additionalTextEdits ?? [])
      if (positionOffset(doc.contents, additional.range.end) <= start)
        start +=
          additional.newText.length -
          (positionOffset(doc.contents, additional.range.end) -
            positionOffset(doc.contents, additional.range.start))
    suppressCompletion.current = true
    editor.applyEdits(edits)
    setCompletions([])
    if (expanded?.stops.length) {
      snippet.current = {
        path: at.path,
        stops: expanded.stops.map((stop) => ({
          ...stop,
          start: stop.start + start,
          end: stop.end + start,
        })),
        index: 0,
      }
      selectStop(0)
    } else editor.focus()
  }
  const navigate = async (cursor: Position) => {
    const client = clientRef.current
    if (!client?.ready) return
    const path = propsRef.current.selectedFile
    const result = await client.request<
      Location | Array<Location> | Array<LocationLink> | null
    >('textDocument/definition', {
      textDocument: { uri: fileUri(path) },
      position: cursor,
    })
    if (propsRef.current.selectedFile !== path || !result) return
    const first = Array.isArray(result) ? result.at(0) : result
    if (!first) return
    const uri = 'targetUri' in first ? first.targetUri : first.uri
    const at =
      'targetUri' in first
        ? first.targetSelectionRange.start
        : first.range.start
    if (new URL(uri).pathname.startsWith('/workspace/')) {
      const nextPath = uriPath(uri)
      if (!documentsRef.current[nextPath]) return
      propsRef.current.onSelect(nextPath)
      setTarget({ path: nextPath, position: at })
    } else {
      const nextPath = decodeURIComponent(new URL(uri).pathname)
      if (!nextPath.startsWith('/sdk/') && !nextPath.startsWith('/toolchain/'))
        return
      setSdkHeader({
        path: nextPath,
        contents: await client.readFile(nextPath),
      })
      setTarget({ path: nextPath, position: at })
    }
  }
  const keyboard = (event: React.KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey
    if (event.key === 'Escape') {
      setCompletions([])
      setSdkHeader(null)
      return
    }
    if (
      completions.length &&
      ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)
    ) {
      event.preventDefault()
      event.stopPropagation()
      if (event.key.startsWith('Arrow'))
        setCompletionIndex(
          (index) =>
            (index + (event.key === 'ArrowDown' ? 1 : completions.length - 1)) %
            completions.length,
        )
      else void run(() => accept(completions[completionIndex]))
    } else if (event.key === 'Tab' && snippet.current) {
      event.preventDefault()
      event.stopPropagation()
      selectStop(snippet.current.index + (event.shiftKey ? -1 : 1))
    } else if (mod && event.code === 'Space') {
      event.preventDefault()
      event.stopPropagation()
      void run(complete)
    } else if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault()
      event.stopPropagation()
      void run(async () => {
        await propsRef.current.saveHandlerRef.current?.()
      })
    }
  }
  const shown = sdkHeader ?? selected
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {error && (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {conflicts.map((path) => (
        <div
          key={path}
          role="alert"
          className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"
        >
          <span>
            {path} changed remotely. Your draft is preserved. Review it before
            committing.
          </span>
          <button className="underline" onClick={() => props.onSelect(path)}>
            Review draft
          </button>
          {['Keep draft', 'Use incoming'].map((label) => (
            <button
              key={label}
              className="underline"
              onClick={() => {
                if (label === 'Use incoming') {
                  const next = { ...documentsRef.current }
                  const doc = next[path]!
                  if (doc.baseline === null) delete next[path]
                  else
                    next[path] = {
                      ...doc,
                      contents: doc.baseline,
                      deleted: false,
                      version: doc.version + 1,
                    }
                  const editor = editorRef.current
                  if (
                    props.selectedFile === path &&
                    editor &&
                    !sdkHeader &&
                    doc.baseline !== null
                  ) {
                    const text = editor.getText()
                    editor.applyEdits([
                      {
                        range: {
                          start: { line: 0, character: 0 },
                          end: offsetPosition(text, text.length),
                        },
                        newText: doc.baseline,
                      },
                    ])
                  }
                  publish(next)
                  setEditorRevision((revision) => revision + 1)
                }
                conflictsRef.current = conflictsRef.current.filter(
                  (entry) => entry !== path,
                )
                setConflicts(conflictsRef.current)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ))}
      {shown && !('deleted' in shown && shown.deleted) && (
        <PierreDocument
          key={`${shown.path}:${editorRevision}`}
          path={shown.path}
          contents={shown.contents}
          sessionKey={`${props.workspaceId}:${shown.path}:${editorRevision}`}
          diagnostics={
            sdkHeader
              ? emptyDiagnostics
              : (diagnostics[shown.path] ?? emptyDiagnostics)
          }
          semanticTokens={
            analysis?.path === shown.path &&
            analysis.version === selected?.version &&
            !sdkHeader
              ? analysis.tokens
              : []
          }
          foldingRanges={
            analysis?.path === shown.path &&
            analysis.version === selected?.version &&
            !sdkHeader
              ? analysis.folds
              : []
          }
          readOnly={!!sdkHeader}
          focusPosition={
            target?.path === shown.path ? target.position : undefined
          }
          onEditor={(editor) => {
            editorRef.current = editor
          }}
          onPosition={setPosition}
          onCommand={keyboard}
          onNavigate={(at) => void run(() => navigate(at))}
          onChange={(contents, changes) => {
            if (sdkHeader) return
            if (snippet.current && changes)
              snippet.current.stops = remapSnippetStops(
                snippet.current.stops,
                changes,
              )
            setCompletions([])
            publish(updateDocument(documentsRef.current, shown.path, contents))
            setDiagnostics((old) => ({ ...old, [shown.path]: [] }))
          }}
        />
      )}
      {completions.length > 0 && (
        <div
          role="listbox"
          aria-label="Completions"
          className="fixed z-50 max-h-72 w-96 overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
          style={anchor}
        >
          {completions.map((item, index) => (
            <button
              key={`${item.label}:${index}`}
              role="option"
              aria-selected={index === completionIndex}
              className={`block w-full rounded px-3 py-1.5 text-left font-mono text-xs ${index === completionIndex ? 'bg-accent' : 'hover:bg-accent'}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void run(() => accept(item))}
            >
              {item.label}
              <span className="ml-2 text-muted-foreground">{item.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
