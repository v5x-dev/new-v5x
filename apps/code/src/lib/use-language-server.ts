import * as React from 'react'
import { useAction, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { LanguageServerClient } from './language-server-client'
import { BrowserLspTransport } from './browser-lsp-transport'
import { safeWorkspacePath } from './browser-lsp-types'
import type { WorkspaceFile } from './browser-lsp-types'
import { LspWorkspace } from './lsp-workspace'

export function useLanguageServer(
  programId: Id<'program'>,
  selectedFile?: string,
) {
  const selectedFileRef = React.useRef(selectedFile)
  selectedFileRef.current = selectedFile
  const workspace = React.useMemo(() => new LspWorkspace(), [programId])
  const program = useQuery(api.program.get, { programId })
  const getFiles = useAction(api.program.getProgramFiles)
  const getFile = useAction(api.program.getProgramFile)
  const [client, setClient] = React.useState<LanguageServerClient | null>(null)
  const [status, setStatus] = React.useState('Starting C++ tools…')
  const [state, setState] = React.useState<'starting' | 'ready' | 'error'>(
    'starting',
  )
  const [generation, retry] = React.useReducer((value: number) => value + 1, 0)
  const template = program?.template ?? 'vexcode'
  const hasProgram = !!program

  React.useEffect(() => {
    if (!hasProgram) return
    let active = true
    let connection: LanguageServerClient | undefined
    const updateStatus = (message: string) => {
      if (active) setStatus(message)
    }
    setClient(null)
    setState('starting')
    updateStatus('Loading project for C++ tools…')
    void (async () => {
      try {
        const { paths } = await getFiles({ programId })
        if (!active) return
        const remaining = paths.filter(
          (path) =>
            safeWorkspacePath(path) &&
            !/^(build|bin|\.git|\.cache|firmware)\//.test(path) &&
            (/\.(c|cc|cpp|cxx|c\+\+|h|hh|hpp|hxx|inc|inl|tpp|ipp)$/i.test(
              path,
            ) ||
              path === '.clangd' ||
              path === '.v5x-lsp.json'),
        )
        const files: WorkspaceFile[] = []
        // Bound backend requests, especially for the larger EZ/JAR projects.
        await Promise.all(
          Array.from({ length: Math.min(6, remaining.length) }, async () => {
            while (active && remaining.length) {
              const path = remaining.shift()!
              const contents = await getFile({ programId, path })
              if (active) files.push({ path, contents })
            }
          }),
        )
        if (!active) return
        workspace.seed(files)
        connection = new LanguageServerClient(
          new BrowserLspTransport(
            programId,
            template,
            workspace.all().map(({ path, contents }) => ({ path, contents })),
            updateStatus,
          ),
          workspace,
        )
        await connection.connect()
        if (!active) {
          void connection.dispose()
          return
        }
        const initialPath =
          selectedFileRef.current ??
          workspace
            .all()
            .find(({ path }) => /(^|\/)main\.(cpp|cc|cxx|c)$/.test(path))?.path
        const initialFile = initialPath ? workspace.get(initialPath) : undefined
        if (initialPath && initialFile)
          connection.openDocument(initialPath, initialFile.contents)
        setClient(connection)
        // Initialization does not mean the active translation unit is parsed.
        // The active-file effect below waits for an AST-backed response.
        connection.onDisconnect(() => {
          if (active) {
            setClient(null)
            setState('error')
            updateStatus('C++ tools stopped')
          }
        })
      } catch (error) {
        void connection?.dispose()
        if (active) setState('error')
        updateStatus(
          error instanceof Error ? error.message : 'C++ tools unavailable',
        )
      }
    })()
    return () => {
      active = false
      void connection?.dispose()
    }
  }, [
    programId,
    template,
    hasProgram,
    generation,
    getFiles,
    getFile,
    workspace,
  ])

  React.useEffect(() => {
    if (!client) return
    const path =
      selectedFile ??
      workspace
        .all()
        .find(({ path }) => /(^|\/)main\.(cpp|cc|cxx|c)$/.test(path))?.path
    const file = path ? workspace.get(path) : undefined
    if (
      !path ||
      !file ||
      !/\.(c|cc|cpp|cxx|c\+\+|h|hh|hpp|hxx|inc|inl|tpp|ipp)$/i.test(path)
    ) {
      setState('ready')
      setStatus('C++ tools ready')
      return
    }
    const controller = new AbortController()
    setState('starting')
    setStatus(`Preparing ${path}…`)
    client.openDocument(path, file.contents)
    // documentSymbol runs after clangd builds this file's preamble and AST.
    // A transport/initialize response alone cannot establish hover readiness.
    void client
      .symbols(path, controller.signal)
      .then(() => {
        if (controller.signal.aborted) return
        setState('ready')
        setStatus('C++ tools ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState('error')
        setStatus(
          error instanceof Error
            ? error.message
            : 'Could not prepare C++ tools',
        )
      })
    return () => controller.abort()
  }, [client, selectedFile, workspace])

  return { client, status, state, retry, workspace }
}
