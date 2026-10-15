import * as React from 'react'
import type { Diagnostic } from 'vscode-languageserver-protocol'
import { compileCommands, type ProjectTemplate } from '@v5x/compiler'
import { ClangdClient } from '~/lib/ide/clangd-client'
import { headerPattern, sourcePattern } from '~/lib/ide/language-features'
import {
  isDirty,
  liveFiles,
  uriPath,
  workspaceDocuments,
} from '~/lib/ide/workspace'
import type { WorkspaceDocumentStore } from './use-workspace-documents'

const MAX_DIAGNOSTICS_PER_FILE = 64

interface Options {
  store: WorkspaceDocumentStore
  workspaceId: string
  // null waits for the compilation server setting. An empty string runs
  // clangd in the browser.
  languageServer: string | null | undefined
  template: ProjectTemplate
  workspaceLoaded: boolean
  selectedFile: string
  selectedFileRef: { current: string }
  onError: (message: string) => void
}

// Runs clangd for the loaded workspace, keeps it in sync with the live
// documents and collects its diagnostics.
export function useLanguageClient({
  store,
  workspaceId,
  languageServer,
  template,
  workspaceLoaded,
  selectedFile,
  selectedFileRef,
  onError,
}: Options) {
  const { documentsRef, pendingSyncRef } = store
  const clientRef = React.useRef<ClangdClient | null>(null)
  const syncedPathsRef = React.useRef(new Set<string>())
  const previousSelectedPathRef = React.useRef(selectedFile)
  const previousReadyRef = React.useRef(false)
  const onErrorRef = React.useRef(onError)
  onErrorRef.current = onError

  const [ready, setReady] = React.useState(false)
  const [diagnostics, setDiagnostics] = React.useState<
    Record<string, Array<Diagnostic>>
  >({})
  const diagnosticsRef = React.useRef(diagnostics)
  const [diagnosticsRevision, setDiagnosticsRevision] = React.useState(0)

  React.useEffect(() => {
    setReady(false)
    previousReadyRef.current = false
    syncedPathsRef.current.clear()

    if (!workspaceLoaded || languageServer === null) return

    let active = true

    const client = new ClangdClient(
      {
        status: () => {},
        error: (reason) => {
          if (active) onErrorRef.current(reason.message)
        },
        applyEdit: () =>
          Promise.reject(
            new Error('Server-requested workspace edits are disabled'),
          ),
        diagnostics: (uri, entries, version) => {
          if (!active) return
          const path = uriPath(uri)

          if (
            version !== undefined &&
            documentsRef.current[path]?.version !== version
          )
            return

          setDiagnostics((old) => {
            const next: Record<string, Array<Diagnostic>> = {
              ...old,
              [path]: entries
                .slice(0, MAX_DIAGNOSTICS_PER_FILE)
                .map((entry) => ({
                  range: entry.range,
                  severity: entry.severity,
                  message: entry.message,
                  source: entry.source,
                })),
            }

            // Keep diagnostics for the open file and edited files only.
            const selected = selectedFileRef.current
            for (const retained of Object.keys(next)) {
              const doc = documentsRef.current[retained]
              if (
                retained !== path &&
                retained !== selected &&
                !(doc && isDirty(doc))
              )
                delete next[retained]
            }

            diagnosticsRef.current = next
            return next
          })
        },
      },
      languageServer ?? '',
    )

    clientRef.current = client
    onErrorRef.current('')

    void (async () => {
      const files = liveFiles(documentsRef.current)
      const response = await fetch('/language/sdk-manifest.json')
      if (!response.ok) throw new Error('Language SDK manifest is missing')
      const manifest = (await response.json()) as { gccVersion: string }
      if (!active) return

      syncedPathsRef.current = new Set(Object.keys(files))

      await client.start(
        files,
        template,
        compileCommands(files, template, manifest.gccVersion),
        workspaceId,
      )

      if (active) {
        pendingSyncRef.current.full = true
        setReady(true)
      }
    })().catch((reason) => {
      if (active)
        onErrorRef.current(
          reason instanceof Error ? reason.message : String(reason),
        )
    })

    return () => {
      active = false
      client.stop()
      if (clientRef.current === client) clientRef.current = null
    }
  }, [workspaceLoaded, workspaceId, languageServer])

  // Sources are opened in clangd. Headers are only opened while selected or
  // edited, and are otherwise written to its virtual file system.
  React.useEffect(() => {
    const previousSelectedPath = previousSelectedPathRef.current
    const selectedPathChanged = previousSelectedPath !== selectedFile
    const becameReady = ready && !previousReadyRef.current
    previousSelectedPathRef.current = selectedFile
    previousReadyRef.current = ready

    if (!ready) return

    const client = clientRef.current
    if (!client) return

    const pending = pendingSyncRef.current
    const pendingPaths = new Set(pending.paths)
    if (selectedPathChanged || becameReady) {
      pendingPaths.add(selectedFile)
      if (selectedPathChanged) pendingPaths.add(previousSelectedPath)
    }

    const syncDocument = (path: string) => {
      const doc = documentsRef.current[path]
      if (!doc || doc.deleted) {
        if (syncedPathsRef.current.has(path)) client.remove(path)
        syncedPathsRef.current.delete(path)
        return
      }

      if (
        sourcePattern.test(doc.path) ||
        (headerPattern.test(doc.path) &&
          (doc.path === selectedFile || isDirty(doc)))
      )
        client.sync(doc.path, doc.contents, doc.version)
      else client.setFile(doc.path, doc.contents, doc.version)

      syncedPathsRef.current.add(path)
    }

    if (pending.full) {
      const livePaths = new Set(Object.keys(liveFiles(documentsRef.current)))

      for (const path of syncedPathsRef.current)
        if (!livePaths.has(path)) client.remove(path)

      syncedPathsRef.current = livePaths

      for (const doc of workspaceDocuments(documentsRef.current))
        syncDocument(doc.path)
    } else {
      for (const path of pendingPaths) syncDocument(path)
    }

    pending.full = false
    pending.paths.clear()
  }, [store.documents, store.documentRevision, selectedFile, ready])

  // Edited text invalidates its diagnostics until clangd reports again.
  const clearDiagnostics = React.useCallback((path: string) => {
    const entries = diagnosticsRef.current[path]
    if (!entries?.length) return

    delete diagnosticsRef.current[path]
    setDiagnosticsRevision((revision) => revision + 1)
  }, [])

  return {
    clientRef,
    ready,
    diagnostics,
    diagnosticsRevision,
    clearDiagnostics,
  }
}
