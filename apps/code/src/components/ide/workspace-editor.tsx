import * as React from 'react'
import { WorkspaceEditorTabs } from './workspace-editor-tabs'
import { WorkspaceFilePicker } from './workspace-file-picker'
import { WorkspaceSearch } from './workspace-search'
import { WorkspacePanels } from './workspace-panels'
import { WorkspaceEditorToolbar } from './workspace-editor-toolbar'
import { WorkspaceCompletions } from './workspace-completions'
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
import type { FileOperations } from '~/lib/ide/file-operations'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
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
  searchWorkspace,
  updateDocument,
  uriPath,
  workspaceDocuments,
} from '~/lib/ide/workspace'
import {
  expandSnippet,
  offsetPosition,
  remapSnippetStops,
} from '~/lib/ide/snippets'
import {
  applyFileOperation,
  readFiles,
  withinPath,
} from '~/lib/ide/file-operations'
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
  fileOperationsRef?: { current: FileOperations | null }
  saveHandlerRef: { current: (() => Promise<void>) | null }
}

const emptyDiagnostics: Array<Diagnostic> = []

const emptyTokens: Array<SemanticColor> = []

const emptyFolds: Array<FoldingRange> = []

export function WorkspaceEditor(props: Props) {
  const propsRef = React.useRef(props)
  propsRef.current = props
  const [tabs, setTabs] = React.useState<Array<string>>([])
  const [workspaceLoaded, setWorkspaceLoaded] = React.useState(false)
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

  const syncedPathsRef = React.useRef(new Set<string>())
  const clientRef = React.useRef<ClangdClient | null>(null)
  const editorRef = React.useRef<PierreEditor | null>(null)
  const [ready, setReady] = React.useState(false)
  const [panel, setPanel] = React.useState<'problems' | 'output' | null>(null)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [matchCase, setMatchCase] = React.useState(false)
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const searchResults = React.useMemo(
    () =>
      searchOpen ? searchWorkspace(documents, searchQuery, matchCase) : [],
    [documents, searchQuery, matchCase, searchOpen],
  )

  const searchGroups = React.useMemo(() => {
    const groups = new Map<string, typeof searchResults>()

    for (const result of searchResults) {
      const group = groups.get(result.path)

      if (group) group.push(result)
      else groups.set(result.path, [result])
    }

    return groups
  }, [searchResults])

  const openSearch = () => {
    setSearchOpen(true)

    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }

  const [fileQuery, setFileQuery] = React.useState<string | null>(null)

  React.useEffect(() => {
    const openFile = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'p'
      ) {
        event.preventDefault()
        setCompletions([])
        setFileQuery('')
      }
    }

    window.addEventListener('keydown', openFile)
    return () => window.removeEventListener('keydown', openFile)
  }, [])

  const [editorRevision, setEditorRevision] = React.useState(0)
  const [error, setError] = React.useState('')

  const [diagnostics, setDiagnostics] = React.useState<
    Record<string, Array<Diagnostic>>
  >({})

  const problems = Object.entries(diagnostics)
    .filter(([path]) => documents[path] && !documents[path].deleted)
    .flatMap(([path, entries]) =>
      entries.map((diagnostic) => ({ path, diagnostic })),
    )
    .sort((a, b) => (a.diagnostic.severity ?? 3) - (b.diagnostic.severity ?? 3))

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
    for (const doc of workspaceDocuments(documentsRef.current)) {
      if (!doc.deleted && (!next[doc.path] || next[doc.path]?.deleted))
        clientRef.current?.remove(doc.path)
    }

    documentsRef.current = next
    React.startTransition(() => setDocuments(next))
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
    setWorkspaceLoaded(false)
    setTabs([])
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
      // Initial documents must land with the loaded flag, not in a later transition.
      documentsRef.current = next
      setDocuments(next)

      const restoredTabs = (cached?.tabs ?? []).filter(
        (path) => next[path] && !next[path].deleted,
      )

      const initialPath =
        cached?.selectedFile &&
        next[cached.selectedFile] &&
        !next[cached.selectedFile]?.deleted
          ? cached.selectedFile
          : propsRef.current.selectedFile

      setTabs([
        ...new Set([...restoredTabs, ...(initialPath ? [initialPath] : [])]),
      ])

      if (initialPath !== propsRef.current.selectedFile)
        propsRef.current.onSelect(initialPath)

      setWorkspaceLoaded(true)

      const files = Object.fromEntries(
        workspaceDocuments(next)
          .filter((doc) => !doc.deleted)
          .map((doc) => [doc.path, doc.contents]),
      )

      const response = await fetch('/language/sdk-manifest.json')
      if (!response.ok) throw new Error('Language SDK manifest is missing')
      const manifest = (await response.json()) as { gccVersion: string }
      if (!isActive()) return
      syncedPathsRef.current = new Set(Object.keys(files))

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

    const livePaths = new Set(
      workspaceDocuments(documents)
        .filter((doc) => !doc.deleted)
        .map((doc) => doc.path),
    )

    for (const path of syncedPathsRef.current)
      if (!livePaths.has(path)) clientRef.current?.remove(path)

    syncedPathsRef.current = livePaths

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
    if (!workspaceLoaded) return

    setTabs((current) => {
      const live = current.filter(
        (path) => documents[path] && !documents[path].deleted,
      )

      const path = props.selectedFile

      if (
        path &&
        documents[path] &&
        !documents[path].deleted &&
        !live.includes(path)
      )
        live.push(path)

      return live.length === current.length &&
        live.every((entry, index) => entry === current[index])
        ? current
        : live
    })
  }, [documents, props.selectedFile, workspaceLoaded])

  const pathsKey = JSON.stringify(
    workspaceDocuments(documents)
      .filter((doc) => !doc.deleted)
      .map((doc) => doc.path)
      .sort(),
  )

  React.useEffect(() => {
    if (workspaceLoaded) propsRef.current.onPathsChange(JSON.parse(pathsKey))
  }, [pathsKey, workspaceLoaded])

  React.useEffect(() => {
    props.onDirtyChange(workspaceDocuments(documents).some(isDirty))
    if (!commitRef.current) return

    const timer = setTimeout(() => {
      void writeWorkspace(props.workspaceId, {
        documents,
        conflicts,
        commitSha: commitRef.current,
        tabs,
        selectedFile: props.selectedFile,
        template: props.template,
      }).catch(() => {})
    }, 250)

    return () => clearTimeout(timer)
  }, [documents, props.selectedFile, conflicts, tabs])

  React.useEffect(() => {
    setSearchOpen(false)
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

  React.useEffect(() => {
    const ref = props.fileOperationsRef
    if (!ref) return

    ref.current = {
      read: (path) => readFiles(documentsRef.current, path.replace(/\/$/, '')),
      apply: (operation) => {
        if (saving.current) throw new Error('Wait for the commit to finish.')

        if (!commitRef.current)
          throw new Error('Wait for the workspace to load.')

        if (conflictsRef.current.length)
          throw new Error('Resolve recovered draft conflicts first.')

        const next = applyFileOperation(documentsRef.current, operation)
        publish(next)
        const current = propsRef.current.selectedFile
        const source = operation.path.replace(/\/$/, '')

        if (operation.kind === 'move' && withinPath(current, source))
          propsRef.current.onSelect(
            operation.to.replace(/\/$/, '') + current.slice(source.length),
          )
        else if (!next[current] || next[current].deleted) {
          propsRef.current.onSelect(
            workspaceDocuments(next).find((doc) => !doc.deleted)?.path ?? '',
          )
        } else if (operation.kind === 'create' && !operation.folder)
          propsRef.current.onSelect(operation.path)
      },
    }

    return () => {
      ref.current = null
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

    const timer = setTimeout(() => {
      const doc = documentsRef.current[propsRef.current.selectedFile]
      const selection = editorRef.current?.getViewState().selections?.at(-1)
      if (!doc || !selection) return

      const cursor =
        selection.direction === -1 ? selection.start : selection.end

      const offset = positionOffset(doc.contents, cursor)
      const prefix = doc.contents.slice(Math.max(0, offset - 128), offset)
      if (/(?:[A-Za-z_]\w{1,}|\.|->|::)$/.test(prefix)) void run(complete)
    }, 180)

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

  const formatDocument = async () => {
    const client = clientRef.current
    const doc = documentsRef.current[propsRef.current.selectedFile]
    const editor = editorRef.current
    if (!client?.ready || !doc || !editor || sdkHeader) return

    if (!client.capabilities.documentFormattingProvider)
      throw new Error('Formatting is unavailable for this language.')

    const edits = await client.request<Array<TextEdit> | null>(
      'textDocument/formatting',
      {
        textDocument: { uri: fileUri(doc.path) },
        options: { tabSize: 2, insertSpaces: true },
      },
    )

    if (
      propsRef.current.selectedFile !== doc.path ||
      documentsRef.current[doc.path]?.version !== doc.version
    )
      return

    if (edits?.length) editor.applyEdits(edits)
    editor.focus()
  }

  const keyboard = (event: React.KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey

    if (mod && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      event.stopPropagation()
      openSearch()
      return
    }

    if (mod && event.key.toLowerCase() === 'j') {
      event.preventDefault()
      event.stopPropagation()
      setPanel(panel ? null : 'problems')
      return
    }

    if (event.shiftKey && event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      event.stopPropagation()
      void run(formatDocument)
      return
    }

    if (event.key === 'F12') {
      event.preventDefault()
      event.stopPropagation()
      void run(() => navigate(position))
      return
    }

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
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden"
      onKeyDown={(event) => {
        if (
          !event.defaultPrevented &&
          (event.ctrlKey || event.metaKey) &&
          ((event.shiftKey && event.key.toLowerCase() === 'f') ||
            event.key.toLowerCase() === 'j')
        )
          keyboard(event)
      }}
    >
      <WorkspaceEditorTabs
        tabs={tabs}
        documents={documents}
        selectedFile={props.selectedFile}
        showingHeader={!!sdkHeader}
        onSelect={(path) => {
          setSdkHeader(null)
          setSearchOpen(false)
          props.onSelect(path)
        }}
        onClose={(path) => {
          const remaining = tabs.filter((entry) => entry !== path)
          setTabs(remaining)

          if (props.selectedFile === path) {
            setSdkHeader(null)

            props.onSelect(
              remaining[Math.min(tabs.indexOf(path), remaining.length - 1)] ??
                '',
            )
          }
        }}
        onBack={() => setSdkHeader(null)}
      />
      <WorkspaceFilePicker
        documents={documents}
        fileQuery={fileQuery}
        setFileQuery={setFileQuery}
        onSelect={(path) => {
          setSdkHeader(null)
          setSearchOpen(false)
          props.onSelect(path)
          setFileQuery(null)
        }}
      />
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
          <Button
            variant="ghost"
            size="sm"

            onClick={() => props.onSelect(path)}
          >
            Review draft
          </Button>
          {['Keep draft', 'Use incoming'].map((label) => (
            <Button
              variant="ghost"
              size="sm"
              key={label}

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
            </Button>
          ))}
        </div>
      ))}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <WorkspaceSearch
          searchOpen={searchOpen}
          setSearchOpen={setSearchOpen}
          searchInputRef={searchInputRef}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          matchCase={matchCase}
          setMatchCase={setMatchCase}
          searchResults={searchResults}
          searchGroups={searchGroups}
          onSelect={(result) => {
            setSearchOpen(false)
            setSdkHeader(null)
            props.onSelect(result.path)

            setTarget({
              path: result.path,
              position: { line: result.line, character: result.character },
            })
          }}
        />
        <div className="relative flex min-h-0 flex-1 flex-col">
          {!workspaceLoaded && !error && (
            <div className="grid min-h-0 flex-1 place-items-center">
              <Spinner aria-label="Loading editor" />
            </div>
          )}
          {workspaceLoaded && !shown && (
            <div className="grid min-h-0 flex-1 place-items-center">
              <Button
                variant="ghost"
                size="sm"

                onClick={() => setFileQuery('')}
              >
                Open a file to start editing
              </Button>
            </div>
          )}
          {workspaceLoaded &&
            [
              ...tabs.flatMap((path) => {
                const doc = documents[path]
                return doc && !doc.deleted ? [doc] : []
              }),
              ...(sdkHeader ? [sdkHeader] : []),
            ].map((doc) => {
              const active = doc.path === shown?.path
              const readOnly = doc === sdkHeader

              return (
                <div
                  key={`${doc.path}:${editorRevision}`}
                  // Keep each virtualizer's viewport measurable between tab switches.
                  // display:none makes Pierre discard its rendered lines.
                  className={
                    active
                      ? 'relative flex min-h-0 flex-1 flex-col'
                      : 'pointer-events-none invisible absolute inset-0 flex min-h-0 flex-col'
                  }
                  inert={!active}
                  aria-hidden={!active}
                >
                  <PierreDocument
                    active={active}
                    path={doc.path}
                    contents={doc.contents}
                    sessionKey={`${props.workspaceId}:${doc.path}:${editorRevision}`}
                    diagnostics={
                      readOnly
                        ? emptyDiagnostics
                        : (diagnostics[doc.path] ?? emptyDiagnostics)
                    }
                    semanticTokens={
                      analysis?.path === doc.path &&
                      'version' in doc &&
                      analysis.version === doc.version &&
                      !readOnly
                        ? analysis.tokens
                        : emptyTokens
                    }
                    foldingRanges={
                      analysis?.path === doc.path &&
                      'version' in doc &&
                      analysis.version === doc.version &&
                      !readOnly
                        ? analysis.folds
                        : emptyFolds
                    }
                    readOnly={!!readOnly}
                    focusPosition={
                      active && target?.path === doc.path
                        ? target.position
                        : undefined
                    }
                    onEditor={(editor) => {
                      editorRef.current = editor
                    }}
                    onPosition={(at) => {
                      if (active)
                        setPosition((previous) =>
                          previous.line === at.line &&
                          previous.character === at.character
                            ? previous
                            : at,
                        )
                    }}
                    onCommand={keyboard}
                    onNavigate={(at) => void run(() => navigate(at))}
                    onChange={(contents, changes) => {
                      if (readOnly) return

                      if (active && snippet.current && changes)
                        snippet.current.stops = remapSnippetStops(
                          snippet.current.stops,
                          changes,
                        )

                      if (active)
                        setCompletions((current) =>
                          current.length ? [] : current,
                        )

                      publish(
                        updateDocument(
                          documentsRef.current,
                          doc.path,
                          contents,
                        ),
                      )

                      setDiagnostics((old) =>
                        Object.hasOwn(old, doc.path) && old[doc.path].length
                          ? { ...old, [doc.path]: emptyDiagnostics }
                          : old,
                      )
                    }}
                  />
                </div>
              )
            })}
        </div>
      </div>
      <WorkspacePanels
        panel={panel}
        setPanel={setPanel}
        problems={problems}
        buildOutput={props.buildOutput}
        ready={ready}
        onSelect={({ path, diagnostic }) => {
          setPanel(null)
          setSdkHeader(null)
          props.onSelect(path)
          setTarget({ path, position: diagnostic.range.start })
        }}
      />
      <WorkspaceEditorToolbar
        problems={problems}
        panel={panel}
        setPanel={setPanel}
        searchOpen={searchOpen}
        openSearch={openSearch}
        showingHeader={!!sdkHeader}
        ready={ready}
        hasSelectedFile={!!selected}
        onFormat={() => void run(formatDocument)}
      />
      <WorkspaceCompletions
        completions={completions}
        completionIndex={completionIndex}
        anchor={anchor}
        onAccept={(item) => void run(() => accept(item))}
      />
    </div>
  )
}
