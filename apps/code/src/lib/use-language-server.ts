import * as React from 'react'
import { useAction, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { LanguageServerClient } from './language-server-client'
import { BrowserLspTransport } from './browser-lsp-transport'
import { safeWorkspacePath } from './browser-lsp-types'
import type { WorkspaceFile } from './browser-lsp-types'

export function useLanguageServer(programId: Id<'program'>) {
  const program = useQuery(api.program.get, { programId })
  const getFiles = useAction(api.program.getProgramFiles)
  const getFile = useAction(api.program.getProgramFile)
  const [client, setClient] = React.useState<LanguageServerClient | null>(null)
  const [status, setStatus] = React.useState('Starting local C++ tools…')
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
    updateStatus('Loading project for local C++ tools…')
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
        connection = new LanguageServerClient(
          new BrowserLspTransport(programId, template, files, updateStatus),
        )
        await connection.connect()
        if (!active) {
          void connection.dispose()
          return
        }
        setClient(connection)
        updateStatus('clangd ready · local')
        connection.onDisconnect(() => {
          if (active) {
            setClient(null)
            updateStatus('Local language server stopped')
          }
        })
      } catch (error) {
        void connection?.dispose()
        updateStatus(
          error instanceof Error
            ? error.message
            : 'Local language server unavailable',
        )
      }
    })()
    return () => {
      active = false
      void connection?.dispose()
    }
  }, [programId, template, hasProgram, generation, getFiles, getFile])

  return { client, status, retry }
}
