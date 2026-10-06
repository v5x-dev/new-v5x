import { fileUri } from './workspace'
import type {
  Diagnostic,
  InitializeResult,
  WorkspaceEdit,
} from 'vscode-languageserver-protocol'
import type { CompileCommand, ProjectTemplate } from './compile-commands'

interface RpcMessage {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}
interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  cleanup?: () => void
}
export interface ClangdEvents {
  status: (status: string) => void
  diagnostics: (
    uri: string,
    diagnostics: Array<Diagnostic>,
    version?: number,
  ) => void
  applyEdit: (edit: WorkspaceEdit) => Promise<void>
  error: (error: Error) => void
}
export class ClangdClient {
  private worker: Worker | undefined
  private pending = new Map<number | string, Pending>()
  private nextId = 0
  private fileVersions = new Map<string, number>()
  private opened = new Map<string, number>()
  private queuedSyncs = new Map<string, { contents: string; version: number }>()
  private syncTimer: ReturnType<typeof setTimeout> | undefined

  private flushSyncs() {
    clearTimeout(this.syncTimer)
    this.syncTimer = undefined
    const queued = this.queuedSyncs
    this.queuedSyncs = new Map()
    for (const [path, { contents, version }] of queued)
      this.sendDocument(path, contents, version)
  }
  private startResolve: (() => void) | undefined
  private startReject: ((error: Error) => void) | undefined
  capabilities: InitializeResult['capabilities'] = {}
  ready = false
  constructor(private events: ClangdEvents) {}
  async start(
    files: Record<string, string>,
    template: ProjectTemplate,
    commands: Array<CompileCommand>,
    workspaceId: string,
  ) {
    this.worker = new Worker('/language/clangd-host.js')
    this.worker.onmessage = ({ data }) => {
      if (data.kind === 'status') this.events.status(data.status)
      else if (data.kind === 'error') this.fail(new Error(data.message))
      else if (data.kind === 'started') this.startResolve?.()
      else if (data.kind === 'rpc') void this.receive(data.message)
      else if (data.kind === 'read')
        this.settle(data.id, data.contents, data.error)
    }
    this.worker.onerror = (event) =>
      this.fail(new Error(event.message || 'clangd worker crashed'))
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error('clangd startup timed out'))
        this.stop()
      }, 120_000)
      this.startResolve = () => {
        clearTimeout(timer)
        this.startResolve = undefined
        this.startReject = undefined
        resolve()
      }
      this.startReject = (error) => {
        clearTimeout(timer)
        this.startResolve = undefined
        this.startReject = undefined
        reject(error)
      }
      this.worker!.postMessage({
        kind: 'start',
        files,
        template,
        commands,
        workspaceId,
      })
    })
    const result = await this.request<InitializeResult>('initialize', {
      processId: null,
      rootUri: 'file:///workspace',
      clientInfo: { name: 'v5x Pierre', version: '1' },
      workspaceFolders: [{ uri: 'file:///workspace', name: 'Project' }],
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        workspace: {
          applyEdit: true,
          workspaceEdit: {
            documentChanges: true,
            resourceOperations: ['create', 'rename', 'delete'],
            failureHandling: 'transactional',
          },
          configuration: true,
          workspaceFolders: true,
          symbol: { dynamicRegistration: false },
        },
        textDocument: {
          synchronization: { didSave: true },
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['plaintext'],
              resolveSupport: {
                properties: ['documentation', 'detail', 'additionalTextEdits'],
              },
              insertReplaceSupport: true,
            },
          },
          hover: { contentFormat: ['plaintext'] },
          signatureHelp: {
            signatureInformation: { documentationFormat: ['plaintext'] },
          },
          publishDiagnostics: {
            relatedInformation: true,
            versionSupport: true,
          },
          codeAction: {
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: [
                  '',
                  'quickfix',
                  'refactor',
                  'refactor.extract',
                  'refactor.inline',
                  'refactor.rewrite',
                  'source',
                  'source.organizeImports',
                ],
              },
            },
            resolveSupport: { properties: ['edit'] },
          },
          rename: { prepareSupport: true },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          semanticTokens: {
            requests: { full: true },
            tokenTypes: [
              'namespace',
              'type',
              'class',
              'enum',
              'interface',
              'struct',
              'typeParameter',
              'parameter',
              'variable',
              'property',
              'enumMember',
              'event',
              'function',
              'method',
              'macro',
              'keyword',
              'modifier',
              'comment',
              'string',
              'number',
              'regexp',
              'operator',
              'decorator',
            ],
            tokenModifiers: [
              'declaration',
              'definition',
              'readonly',
              'static',
              'deprecated',
              'abstract',
              'async',
              'modification',
              'documentation',
              'defaultLibrary',
            ],
            formats: ['relative'],
            overlappingTokenSupport: false,
            multilineTokenSupport: false,
          },
          foldingRange: { lineFoldingOnly: true },
          inlayHint: {},
          callHierarchy: {},
          typeHierarchy: {},
        },
        window: { workDoneProgress: true },
      },
      initializationOptions: { clangdFileStatus: true },
    })
    if (
      result.capabilities.positionEncoding &&
      result.capabilities.positionEncoding !== 'utf-16'
    )
      throw new Error('clangd must use UTF-16 positions for Pierre')
    this.capabilities = result.capabilities
    this.notify('initialized', {})
    this.ready = true
    this.events.status('clangd ready')
  }
  private fail(error: Error) {
    this.ready = false
    this.startReject?.(error)
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.cleanup?.()
      entry.reject(error)
    }
    this.pending.clear()
    this.events.error(error)
  }
  private settle(
    id: number | string,
    result: unknown,
    error?: { message: string },
  ) {
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    pending.cleanup?.()
    this.pending.delete(id)
    if (error) pending.reject(new Error(error.message))
    else pending.resolve(result)
  }
  private async receive(message: RpcMessage) {
    if (!message.method) {
      if (message.id !== undefined)
        this.settle(message.id, message.result, message.error)
      return
    }
    if (message.id !== undefined) {
      let result: unknown = null
      try {
        if (message.method === 'workspace/applyEdit') {
          await this.events.applyEdit(
            (message.params as { edit: WorkspaceEdit }).edit,
          )
          result = { applied: true }
        } else if (message.method === 'workspace/configuration') {
          result = (message.params as { items: Array<unknown> }).items.map(
            () => null,
          )
        } else if (message.method === 'workspace/workspaceFolders')
          result = [{ uri: 'file:///workspace', name: 'Project' }]
        else if (
          ![
            'window/workDoneProgress/create',
            'client/registerCapability',
            'client/unregisterCapability',
          ].includes(message.method)
        ) {
          this.send({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: 'Unsupported client request' },
          })
          return
        }
        this.send({ jsonrpc: '2.0', id: message.id, result })
      } catch (error) {
        this.send({
          jsonrpc: '2.0',
          id: message.id,
          result: { applied: false, failureReason: String(error) },
        })
      }
    } else if (message.method === 'textDocument/publishDiagnostics') {
      const params = message.params as {
        uri: string
        diagnostics: Array<Diagnostic>
        version?: number
      }
      this.events.diagnostics(params.uri, params.diagnostics, params.version)
    } else if (message.method === '$/progress') {
      const value = (
        message.params as {
          value: {
            kind?: string
            title?: string
            message?: string
            percentage?: number
          }
        }
      ).value
      if (value.kind === 'end') this.events.status('clangd ready')
      else
        this.events.status(
          [
            value.title || 'Indexing',
            value.message,
            value.percentage == null ? '' : `${value.percentage}%`,
          ]
            .filter(Boolean)
            .join(' · '),
        )
    }
  }
  private send(message: RpcMessage) {
    if (!this.worker) throw new Error('Language worker is stopped')
    this.worker.postMessage({ kind: 'rpc', message })
  }
  request<T>(
    method: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    // Commands must see the latest text even during a burst of typing.
    this.flushSyncs()
    return new Promise<T>((resolve, reject) => {
      const id = ++this.nextId
      const cancel = () => {
        this.notify('$/cancelRequest', { id })
        this.settle(id, undefined, { message: 'Language request cancelled' })
      }
      if (signal?.aborted) {
        reject(new Error('Language request cancelled'))
        return
      }
      const timer = setTimeout(() => {
        this.notify('$/cancelRequest', { id })
        this.settle(id, undefined, { message: `${method} timed out` })
      }, 30_000)
      signal?.addEventListener('abort', cancel, { once: true })
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        cleanup: () => signal?.removeEventListener('abort', cancel),
      })
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        this.settle(id, undefined, { message: String(error) })
      }
    })
  }
  notify(method: string, params: unknown) {
    this.send({ jsonrpc: '2.0', method, params })
  }
  sync(path: string, contents: string, version: number) {
    if (!this.ready || this.opened.get(path) === version) return
    if (!this.opened.has(path)) {
      this.sendDocument(path, contents, version)
      return
    }
    this.queuedSyncs.set(path, { contents, version })
    // Bound the delay while coalescing full-document copies and clangd reparses.
    if (this.syncTimer === undefined)
      this.syncTimer = setTimeout(() => this.flushSyncs(), 120)
  }
  private sendDocument(path: string, contents: string, version: number) {
    if (!this.ready) return
    if (this.opened.get(path) === version) return
    const uri = fileUri(path)
    this.fileVersions.set(path, version)
    this.worker?.postMessage({ kind: 'files', files: { [path]: contents } })
    if (!this.opened.has(path))
      this.notify('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: path.endsWith('.c') ? 'c' : 'cpp',
          version,
          text: contents,
        },
      })
    else if (this.opened.get(path) !== version)
      this.notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text: contents }],
      })
    this.opened.set(path, version)
  }
  setFile(path: string, contents: string, version: number) {
    if (!this.ready || this.fileVersions.get(path) === version) return
    this.fileVersions.set(path, version)
    this.worker?.postMessage({ kind: 'files', files: { [path]: contents } })
    this.notify('workspace/didChangeWatchedFiles', {
      changes: [{ uri: fileUri(path), type: 2 }],
    })
  }
  remove(path: string) {
    this.queuedSyncs.delete(path)
    if (!this.ready || (!this.opened.has(path) && !this.fileVersions.has(path)))
      return
    this.fileVersions.delete(path)
    if (this.opened.has(path))
      this.notify('textDocument/didClose', {
        textDocument: { uri: fileUri(path) },
      })
    this.opened.delete(path)
    this.worker?.postMessage({ kind: 'files', files: { [path]: null } })
    this.notify('workspace/didChangeWatchedFiles', {
      changes: [{ uri: fileUri(path), type: 3 }],
    })
  }
  save(path: string) {
    if (this.ready)
      this.notify('textDocument/didSave', {
        textDocument: { uri: fileUri(path) },
      })
  }
  readFile(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      const timer = setTimeout(
        () => this.settle(id, undefined, { message: 'Header read timed out' }),
        10_000,
      )
      this.pending.set(id, {
        resolve: (value) => resolve(value as string),
        reject,
        timer,
      })
      this.worker?.postMessage({ kind: 'read', id, path })
    })
  }
  stop() {
    clearTimeout(this.syncTimer)
    this.syncTimer = undefined
    this.queuedSyncs.clear()
    this.ready = false
    this.startReject?.(new Error('Language worker stopped'))
    this.worker?.postMessage({ kind: 'stop' })
    // Allow the host to terminate its pthread workers before terminating the host.
    const worker = this.worker
    if (worker) setTimeout(() => worker.terminate(), 100)
    this.worker = undefined
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.cleanup?.()
      pending.reject(new Error('Language worker stopped'))
    }
    this.pending.clear()
    this.opened.clear()
    this.fileVersions.clear()
  }
}
