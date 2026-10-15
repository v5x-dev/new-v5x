import * as React from 'react'
import type { Diagnostic, Position } from 'vscode-languageserver-protocol'
import type { ProjectTemplate } from '@v5x/compiler'
import { BrainTerminal, type BrainTerminalProps } from './brain-terminal'
import { DraftConflicts } from './draft-conflicts'
import { DraftStatus } from './draft-status'
import { PierreDocument, type PierreEditor } from './pierre-document'
import { WorkspaceCompletions } from './workspace-completions'
import { WorkspaceEditorTabs } from './workspace-editor-tabs'
import { WorkspaceEditorToolbar } from './workspace-editor-toolbar'
import { WorkspaceFilePicker } from './workspace-file-picker'
import { WorkspacePanels } from './workspace-panels'
import { WorkspaceSearch } from './workspace-search'
import { Alert, AlertDescription } from '@v5x/ui/components/alert'
import { Button } from '@v5x/ui/components/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@v5x/ui/components/resizable'
import { Skeleton } from '@v5x/ui/components/skeleton'
import { useCompletions } from '~/hooks/use-completions'
import { useDraftWriter } from '~/hooks/use-draft-writer'
import { useLanguageClient } from '~/hooks/use-language-client'
import { useSemanticAnalysis } from '~/hooks/use-semantic-analysis'
import { useWorkspaceDocuments } from '~/hooks/use-workspace-documents'
import {
  useWorkspaceSearch,
  type SearchResult,
} from '~/hooks/use-workspace-search'
import { parseBuildProblems } from '~/lib/ide/build-problems'
import {
  applyFileOperation,
  readFiles,
  withinPath,
  type FileOperations,
} from '~/lib/ide/file-operations'
import { formatWorkspace } from '~/lib/ide/format-workspace'
import { requestDefinition } from '~/lib/ide/language-features'
import { loadWorkspace, restoredTabs } from '~/lib/ide/load-workspace'
import type { SemanticColor } from '~/lib/ide/semantic-tokens'
import { offsetPosition, remapSnippetStops } from '~/lib/ide/snippets'
import {
  fileUri,
  isDirty,
  liveDocuments,
  liveFiles,
  restoreBaseline,
  workspaceDocuments,
  type CommitChange,
  type ProjectSnapshot,
} from '~/lib/ide/workspace'
import type { FoldingRange, TextEdit } from 'vscode-languageserver-protocol'

const MAX_MOUNTED_EDITORS = 1

// The tabs and picker show dirty markers, which change without a new
// documents object. The revision forces those re-renders.
const MemoWorkspaceEditorTabs = React.memo(
  ({
    dirtyRevision: _dirtyRevision,
    ...props
  }: React.ComponentProps<typeof WorkspaceEditorTabs> & {
    dirtyRevision: number
  }) => {
    void _dirtyRevision
    return <WorkspaceEditorTabs {...props} />
  },
)

const MemoWorkspaceFilePicker = React.memo(
  ({
    dirtyRevision: _dirtyRevision,
    ...props
  }: React.ComponentProps<typeof WorkspaceFilePicker> & {
    dirtyRevision: number
  }) => {
    void _dirtyRevision
    return <WorkspaceFilePicker {...props} />
  },
)

const MemoWorkspaceSearch = React.memo(WorkspaceSearch)

const MemoWorkspacePanels = React.memo(WorkspacePanels)

const emptyDiagnostics: Array<Diagnostic> = []

const emptyTokens: Array<SemanticColor> = []

const emptyFolds: Array<FoldingRange> = []

type Panel = 'problems' | 'output' | 'terminal'

interface Props {
  onBuild?: () => void
  // Opens the output panel whenever the number changes.
  outputRequest?: number
  statusBarEnd?: React.ReactNode
  brainTerminal?: BrainTerminalProps
  workspaceId: string
  languageServer?: string | null
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
  buildSnapshotRef?: { current: (() => ProjectSnapshot) | null }
}

const isModified = (event: { ctrlKey: boolean; metaKey: boolean }) =>
  event.ctrlKey || event.metaKey

// Editor-wide shortcuts that also apply outside Pierre.
const isGlobalShortcut = (event: React.KeyboardEvent) => {
  const key = event.key.toLowerCase()
  return (
    isModified(event) &&
    ((event.shiftKey && key === 'f') || key === 'j' || key === 'b')
  )
}

export function WorkspaceEditor(props: Props) {
  const propsRef = React.useRef(props)
  propsRef.current = props
  const selectedFileRef = React.useRef(props.selectedFile)
  selectedFileRef.current = props.selectedFile

  const store = useWorkspaceDocuments()
  const { documents, documentsRef } = store
  const drafts = useDraftWriter(props.workspaceId)
  const search = useWorkspaceSearch(documents, store.documentRevision)

  const [error, setError] = React.useState('')
  const [loadAttempt, setLoadAttempt] = React.useState(0)
  const [workspaceLoaded, setWorkspaceLoaded] = React.useState(false)
  const [tabs, setTabs] = React.useState<Array<string>>([])
  const tabsRef = React.useRef(tabs)
  tabsRef.current = tabs
  const [recentEditorPaths, setRecentEditorPaths] = React.useState<
    Array<string>
  >([])
  const [conflicts, setConflicts] = React.useState<Array<string>>([])
  const conflictsRef = React.useRef(conflicts)
  const commitRef = React.useRef('')
  const savingRef = React.useRef(false)

  const editorRef = React.useRef<PierreEditor | null>(null)
  // Remounts every editor after its text is replaced outside Pierre.
  const [editorRevision, setEditorRevision] = React.useState(0)
  const [panel, setPanel] = React.useState<Panel | null>(null)
  const [fileQuery, setFileQuery] = React.useState<string | null>(null)
  const [position, setPosition] = React.useState<Position>({
    line: 0,
    character: 0,
  })
  const [target, setTarget] = React.useState<{
    path: string
    position: Position
  } | null>(null)
  // A read-only SDK or toolchain header opened through go to definition.
  const [sdkHeader, setSdkHeader] = React.useState<{
    path: string
    contents: string
  } | null>(null)

  const selected = documents[props.selectedFile]

  const run = async (task: () => Promise<void>) => {
    try {
      setError('')
      await task()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const language = useLanguageClient({
    store,
    workspaceId: props.workspaceId,
    languageServer: props.languageServer,
    template: props.template,
    workspaceLoaded,
    selectedFile: props.selectedFile,
    selectedFileRef,
    onError: setError,
  })
  const { clientRef, ready, diagnostics } = language

  const analysis = useSemanticAnalysis({
    clientRef,
    ready,
    selected,
    paused: !!sdkHeader,
    documentsRef,
  })

  const completion = useCompletions({
    clientRef,
    editorRef,
    documentsRef,
    selectedFileRef,
    ready,
    selected,
    position,
    run,
  })

  const problems = React.useMemo(
    () =>
      [
        ...parseBuildProblems(props.buildOutput ?? ''),
        ...Object.entries(diagnostics)
          .filter(([path]) => documents[path] && !documents[path].deleted)
          .flatMap(([path, entries]) =>
            entries.map((diagnostic) => ({ path, diagnostic })),
          ),
      ].sort(
        (a, b) => (a.diagnostic.severity ?? 3) - (b.diagnostic.severity ?? 3),
      ),
    [diagnostics, language.diagnosticsRevision, documents, props.buildOutput],
  )

  const setConflictList = (next: Array<string>) => {
    conflictsRef.current = next
    setConflicts(next)
  }

  const scheduleDraft = (commitSha: string, snapshot = documentsRef.current) =>
    drafts.writerRef.current?.schedule({
      documents: snapshot,
      conflicts: conflictsRef.current,
      commitSha,
      tabs: tabsRef.current,
      selectedFile: propsRef.current.selectedFile,
      template: propsRef.current.template,
    })

  React.useEffect(() => {
    let active = true
    setWorkspaceLoaded(false)
    setTabs([])
    store.resetSync()

    void run(async () => {
      const loaded = await loadWorkspace(
        props.workspaceId,
        () => propsRef.current.loadSnapshot(),
        drafts.markUnreadable,
      )
      if (!active) return

      const next = loaded.recovered.documents
      setConflictList(loaded.recovered.conflicts)
      commitRef.current = loaded.commitSha
      store.load(next)

      const restored = restoredTabs(
        loaded.cached,
        next,
        propsRef.current.selectedFile,
      )
      setTabs(restored.tabs)

      if (restored.selectedFile !== propsRef.current.selectedFile)
        propsRef.current.onSelect(restored.selectedFile)

      setWorkspaceLoaded(true)
    })

    return () => {
      active = false
    }
  }, [props.workspaceId, loadAttempt])

  React.useEffect(() => {
    const ref = props.buildSnapshotRef
    if (!ref) return
    ref.current = () => ({
      files: liveFiles(documentsRef.current),
      commitSha: commitRef.current,
    })
    return () => {
      ref.current = null
    }
  }, [props.buildSnapshotRef])

  // Keep tabs for live documents and add the selected file.
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

  React.useEffect(() => {
    if (workspaceLoaded)
      propsRef.current.onPathsChange([...store.workspacePathsRef.current])
  }, [store.pathsRevision, workspaceLoaded])

  React.useEffect(() => {
    propsRef.current.onDirtyChange(store.workspaceDirty)
  }, [store.workspaceDirty])

  React.useEffect(() => {
    if (commitRef.current) scheduleDraft(commitRef.current, documents)
  }, [documents, store.documentRevision, props.selectedFile, conflicts, tabs])

  React.useEffect(() => {
    search.setOpen(false)
    setSdkHeader(null)
    completion.reset()
  }, [props.selectedFile])

  React.useEffect(() => {
    const openFilePicker = (event: KeyboardEvent) => {
      if (
        isModified(event) &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'p'
      ) {
        event.preventDefault()
        completion.clear()
        setFileQuery('')
      }
    }

    window.addEventListener('keydown', openFilePicker)
    return () => window.removeEventListener('keydown', openFilePicker)
  }, [])

  React.useEffect(() => {
    if (props.outputRequest) setPanel('output')
  }, [props.outputRequest])

  // Formats, then commits every dirty document. Registered once because it
  // only reads refs.
  React.useEffect(() => {
    const save = async () => {
      if (savingRef.current) return

      if (conflictsRef.current.length)
        throw new Error('Review recovered drafts before committing.')

      if (!workspaceDocuments(documentsRef.current).some(isDirty)) return
      setError('')
      savingRef.current = true
      propsRef.current.onSavingChange(true)

      try {
        const snapshot = documentsRef.current
        const editGeneration = store.editGenerationRef.current
        const formatted = await formatWorkspace(snapshot, clientRef.current)

        if (
          documentsRef.current !== snapshot ||
          store.editGenerationRef.current !== editGeneration
        )
          throw new Error('The program changed while formatting. Commit again.')

        store.publish(formatted)
        const changed = workspaceDocuments(formatted).filter(isDirty)
        if (!changed.length) return

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

        store.publish(next)
        // Finish the committed recovery snapshot before callers can reload.
        // pagehide cannot keep an asynchronous IndexedDB write alive.
        scheduleDraft(sha, next)
        await drafts.writerRef.current?.flush()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
        throw reason
      } finally {
        savingRef.current = false
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
        if (savingRef.current) throw new Error('Wait for the commit to finish.')

        if (!commitRef.current)
          throw new Error('Wait for the workspace to load.')

        if (conflictsRef.current.length)
          throw new Error('Resolve recovered draft conflicts first.')

        const next = applyFileOperation(documentsRef.current, operation)
        store.publish(next, { pathsChanged: true })
        const current = propsRef.current.selectedFile
        const source = operation.path.replace(/\/$/, '')

        // Follow a moved selection, or pick another file when it was deleted.
        if (operation.kind === 'move' && withinPath(current, source))
          propsRef.current.onSelect(
            operation.to.replace(/\/$/, '') + current.slice(source.length),
          )
        else if (!next[current] || next[current].deleted)
          propsRef.current.onSelect(liveDocuments(next).at(0)?.path ?? '')
        else if (operation.kind === 'create' && !operation.folder)
          propsRef.current.onSelect(operation.path)
      },
    }

    return () => {
      ref.current = null
    }
  }, [])

  const navigate = async (cursor: Position) => {
    const client = clientRef.current
    if (!client?.ready) return
    const path = propsRef.current.selectedFile

    const definition = await requestDefinition(client, path, cursor)
    if (propsRef.current.selectedFile !== path || !definition) return

    if (definition.kind === 'workspace') {
      if (!documentsRef.current[definition.path]) return
      propsRef.current.onSelect(definition.path)
    } else {
      setSdkHeader({
        path: definition.path,
        contents: await client.readFile(definition.path),
      })
    }

    setTarget({ path: definition.path, position: definition.position })
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

  const handled = (event: React.KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const keyboard = (event: React.KeyboardEvent) => {
    const mod = isModified(event)
    const key = event.key.toLowerCase()
    const { completions, completionIndex } = completion

    if (mod && !event.shiftKey && !event.altKey && key === 'b') {
      handled(event)
      propsRef.current.onBuild?.()
    } else if (mod && event.shiftKey && key === 'f') {
      handled(event)
      search.openSearch()
    } else if (mod && key === 'j') {
      handled(event)
      setPanel(panel ? null : 'problems')
    } else if (event.shiftKey && event.altKey && key === 'f') {
      handled(event)
      void run(formatDocument)
    } else if (event.key === 'F12') {
      handled(event)
      void run(() => navigate(position))
    } else if (event.key === 'Escape') {
      completion.clear()
      setSdkHeader(null)
    } else if (
      completions.length &&
      ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)
    ) {
      handled(event)

      if (event.key.startsWith('Arrow'))
        completion.setCompletionIndex(
          (index) =>
            (index + (event.key === 'ArrowDown' ? 1 : completions.length - 1)) %
            completions.length,
        )
      else void run(() => completion.accept(completions[completionIndex]))
    } else if (event.key === 'Tab' && completion.nextStop(event.shiftKey)) {
      handled(event)
    } else if (mod && event.code === 'Space') {
      handled(event)
      void run(completion.complete)
    } else if (mod && key === 's') {
      handled(event)
      void run(async () => {
        await propsRef.current.saveHandlerRef.current?.()
      })
    }
  }

  const shown = sdkHeader ?? selected
  const activeEditorPath = shown?.path

  React.useEffect(() => {
    if (!activeEditorPath) return

    setRecentEditorPaths((current) => {
      if (current.at(-1) === activeEditorPath) return current

      return [
        ...current.filter((path) => path !== activeEditorPath),
        activeEditorPath,
      ].slice(-MAX_MOUNTED_EDITORS)
    })
  }, [activeEditorPath])

  const mountedEditorPaths = [
    ...recentEditorPaths
      .filter((path) => path !== activeEditorPath)
      .slice(-(MAX_MOUNTED_EDITORS - 1)),
    ...(activeEditorPath ? [activeEditorPath] : []),
  ]

  const selectPath = React.useCallback((path: string) => {
    setSdkHeader(null)
    search.setOpen(false)
    propsRef.current.onSelect(path)
  }, [])

  const closeTab = React.useCallback(
    (path: string) => {
      const remaining = tabs.filter((entry) => entry !== path)
      setTabs(remaining)
      setRecentEditorPaths((current) =>
        current.filter((entry) => entry !== path),
      )

      if (propsRef.current.selectedFile === path) {
        setSdkHeader(null)
        propsRef.current.onSelect(
          remaining[Math.min(tabs.indexOf(path), remaining.length - 1)] ?? '',
        )
      }
    },
    [tabs],
  )

  const selectPickerPath = React.useCallback(
    (path: string) => {
      selectPath(path)
      setFileQuery(null)
    },
    [selectPath],
  )

  const backToSource = React.useCallback(() => setSdkHeader(null), [])

  const selectSearchResult = React.useCallback(
    (result: SearchResult) => {
      selectPath(result.path)
      setTarget({
        path: result.path,
        position: { line: result.line, character: result.character },
      })
    },
    [selectPath],
  )

  const selectProblem = React.useCallback(
    ({ path, diagnostic }: { path: string; diagnostic: Diagnostic }) => {
      setPanel(null)
      setSdkHeader(null)
      propsRef.current.onSelect(path)
      setTarget({ path, position: diagnostic.range.start })
    },
    [],
  )

  const resolveConflict = (path: string) =>
    setConflictList(conflictsRef.current.filter((entry) => entry !== path))

  const takeIncoming = (path: string) => {
    const { next, baseline, pathsChanged } = restoreBaseline(
      documentsRef.current,
      path,
    )
    const editor = editorRef.current

    // Replace the open editor's text so its undo history keeps the draft.
    if (
      props.selectedFile === path &&
      editor &&
      !sdkHeader &&
      baseline !== null
    ) {
      const text = editor.getText()
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: offsetPosition(text, text.length),
          },
          newText: baseline,
        },
      ])
    }

    store.publish(next, { pathsChanged })
    setEditorRevision((revision) => revision + 1)
    resolveConflict(path)
  }

  const editorDocuments = [
    ...mountedEditorPaths.flatMap((path) => {
      const doc = documents[path]
      return doc && !doc.deleted ? [doc] : []
    }),
    ...(sdkHeader ? [sdkHeader] : []),
  ]

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden"
      onKeyDown={(event) => {
        if (!event.defaultPrevented && isGlobalShortcut(event)) keyboard(event)
      }}
    >
      <MemoWorkspaceEditorTabs
        tabs={tabs}
        documents={documents}
        dirtyRevision={store.dirtyRevision}
        selectedFile={props.selectedFile}
        showingHeader={!!sdkHeader}
        onSelect={selectPath}
        onClose={closeTab}
        onBack={backToSource}
      />
      <MemoWorkspaceFilePicker
        documents={documents}
        dirtyRevision={store.dirtyRevision}
        fileQuery={fileQuery}
        setFileQuery={setFileQuery}
        onSelect={selectPickerPath}
      />
      {error && (
        <Alert>
          <AlertDescription>{error}</AlertDescription>
          {!workspaceLoaded && (
            <Button
              variant="outline"
              onClick={() => {
                setError('')
                setLoadAttempt((attempt) => attempt + 1)
              }}
            >
              Retry
            </Button>
          )}
        </Alert>
      )}
      <DraftConflicts
        conflicts={conflicts}
        onReview={props.onSelect}
        onKeepDraft={resolveConflict}
        onUseIncoming={takeIncoming}
      />
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="70%" minSize="20%">
          <div className="relative flex h-full min-h-0 flex-col">
            <MemoWorkspaceSearch
              searchOpen={search.open}
              setSearchOpen={search.setOpen}
              searchInputRef={search.inputRef}
              searchQuery={search.query}
              setSearchQuery={search.setQuery}
              matchCase={search.matchCase}
              setMatchCase={search.setMatchCase}
              searchResults={search.results}
              searchGroups={search.groups}
              onSelect={selectSearchResult}
            />
            <div className="relative flex min-h-0 flex-1 flex-col">
              {!workspaceLoaded && !error && (
                <div className="grid min-h-0 flex-1 place-items-center">
                  <Skeleton
                    aria-label="Loading editor"
                    className="h-32 w-3/4"
                  />
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
                editorDocuments.map((doc) => {
                  const active = doc.path === shown?.path
                  const readOnly = doc === sdkHeader
                  const analysed = analysis?.path === doc.path && !readOnly

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
                          analysed ? analysis.tokens : emptyTokens
                        }
                        foldingRanges={
                          analysed &&
                          'version' in doc &&
                          analysis.version === doc.version
                            ? analysis.folds
                            : emptyFolds
                        }
                        readOnly={readOnly}
                        focusPosition={
                          active && target?.path === doc.path
                            ? target.position
                            : undefined
                        }
                        onEditor={(editor) => {
                          editorRef.current = editor
                        }}
                        onPosition={(at) => {
                          if (!active) return

                          // Moving away from where completions were requested
                          // closes them.
                          const requestedAt =
                            completion.contextRef.current?.position
                          if (
                            requestedAt &&
                            (requestedAt.line !== at.line ||
                              requestedAt.character !== at.character)
                          )
                            completion.clear()

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

                          if (active) {
                            if (changes)
                              completion.remapSnippet((stops) =>
                                remapSnippetStops(stops, changes),
                              )
                            completion.clear()
                          }

                          store.publishEdit(doc.path, contents)
                          language.clearDiagnostics(doc.path)
                        }}
                      />
                    </div>
                  )
                })}
            </div>
          </div>
        </ResizablePanel>
        {panel && <ResizableHandle withHandle />}
        <ResizablePanel defaultSize="30%" minSize="15%" hidden={!panel}>
          {props.brainTerminal && (
            <BrainTerminal
              {...props.brainTerminal}
              open={panel === 'terminal'}
              onOpenChange={(open) => {
                if (!open)
                  setPanel((current) =>
                    current === 'terminal' ? null : current,
                  )
              }}
            />
          )}
          <MemoWorkspacePanels
            panel={panel}
            setPanel={setPanel}
            problems={problems}
            buildOutput={props.buildOutput}
            ready={ready}
            onSelect={selectProblem}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <WorkspaceEditorToolbar
        hasBrainTerminal={!!props.brainTerminal}
        problems={problems}
        panel={panel}
        setPanel={setPanel}
        searchOpen={search.open}
        openSearch={search.openSearch}
        showingHeader={!!sdkHeader}
        ready={ready}
        hasSelectedFile={!!selected}
        onFormat={() => void run(formatDocument)}
      >
        <DraftStatus
          status={drafts.status}
          error={drafts.error}
          dirty={store.workspaceDirty}
          files={() => liveFiles(documentsRef.current)}
        />
        {props.statusBarEnd}
      </WorkspaceEditorToolbar>
      <WorkspaceCompletions
        completions={completion.completions}
        completionIndex={completion.completionIndex}
        getAnchor={completion.getAnchor}
        onAccept={(item) => void run(() => completion.accept(item))}
      />
    </div>
  )
}
