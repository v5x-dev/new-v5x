import { BrowserLspTransport } from './browser-lsp-transport'

export type LspPosition = { line: number; character: number }
export type LspRange = { start: LspPosition; end: LspPosition }
export type LspLocation = { uri: string; range: LspRange }

export type LspDiagnostic = {
  range: LspRange
  message: string
  severity?: 1 | 2 | 3 | 4
  source?: string
  code?: number | string
}

type JsonRpcMessage = {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type LspCompletionItem = {
  label: string
  kind?: number
  detail?: string
  documentation?: string | { kind: string; value: string }
  insertText?: string
  insertTextFormat?: number
  sortText?: string
  filterText?: string
  textEdit?: {
    range: LspRange
    newText: string
  }
  additionalTextEdits?: { range: LspRange; newText: string }[]
}

type LspCompletionList =
  LspCompletionItem[] | { isIncomplete?: boolean; items: LspCompletionItem[] }

type DiagnosticsListener = (uri: string, diagnostics: LspDiagnostic[]) => void

export class LanguageServerClient {
  private nextRequestId = 0
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private diagnosticsListeners = new Set<DiagnosticsListener>()
  private disconnectListeners = new Set<() => void>()
  private documents = new Map<string, number>()
  private closed = false

  constructor(private readonly transport: BrowserLspTransport) {}

  async connect() {
    this.transport.onMessage = (message) => {
      void this.handleMessage(message)
    }
    this.transport.onDisconnect = () => {
      this.rejectPending(new Error('Local language server stopped'))
      if (!this.closed)
        for (const listener of this.disconnectListeners) listener()
    }
    await this.transport.start()

    await this.request('initialize', {
      processId: null,
      clientInfo: { name: 'v5x code', version: '1.0.0' },
      rootUri: 'file:///workspace',
      workspaceFolders: [{ uri: 'file:///workspace', name: 'workspace' }],
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        window: { workDoneProgress: true },
        textDocument: {
          completion: {
            completionItem: {
              snippetSupport: false,
              documentationFormat: ['markdown', 'plaintext'],
            },
          },
          definition: { linkSupport: false },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          publishDiagnostics: { relatedInformation: true },
        },
        workspace: { workspaceFolders: true, configuration: true },
      },
    })
    this.notify('initialized', {})
  }

  onDiagnostics(listener: DiagnosticsListener) {
    this.diagnosticsListeners.add(listener)
    return () => this.diagnosticsListeners.delete(listener)
  }

  onDisconnect(listener: () => void) {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }

  openDocument(path: string, text: string) {
    const uri = programPathToUri(path)
    const currentVersion = this.documents.get(uri)
    if (currentVersion !== undefined) {
      this.changeDocument(path, text)
      return
    }

    this.documents.set(uri, 1)
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: languageIdForPath(path),
        version: 1,
        text,
      },
    })
  }

  changeDocument(path: string, text: string) {
    const uri = programPathToUri(path)
    const version = (this.documents.get(uri) ?? 0) + 1
    this.documents.set(uri, version)
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    })
  }

  closeDocument(path: string) {
    const uri = programPathToUri(path)
    if (!this.documents.delete(uri)) return
    this.notify('textDocument/didClose', { textDocument: { uri } })
  }

  async syncSavedFile(path: string, contents: string) {
    await this.request('t3/syncFile', { path, contents })
    this.notify('textDocument/didSave', {
      textDocument: { uri: programPathToUri(path) },
      text: contents,
    })
  }

  async completion(path: string, position: LspPosition) {
    const result = await this.request<LspCompletionList | null>(
      'textDocument/completion',
      { textDocument: { uri: programPathToUri(path) }, position },
    )
    if (result === null) return []
    return Array.isArray(result) ? result : result.items
  }

  hover(path: string, position: LspPosition) {
    return this.request<unknown | null>('textDocument/hover', {
      textDocument: { uri: programPathToUri(path) },
      position,
    })
  }

  definition(path: string, position: LspPosition) {
    return this.request<LspLocation | LspLocation[] | null>(
      'textDocument/definition',
      { textDocument: { uri: programPathToUri(path) }, position },
    )
  }

  references(path: string, position: LspPosition, includeDeclaration: boolean) {
    return this.request<LspLocation[] | null>('textDocument/references', {
      textDocument: { uri: programPathToUri(path) },
      position,
      context: { includeDeclaration },
    })
  }

  async dispose() {
    if (this.closed) return
    this.closed = true
    if (this.transport.ready) {
      for (const uri of this.documents.keys()) {
        this.notify('textDocument/didClose', { textDocument: { uri } })
      }
      try {
        await this.request('shutdown', null)
        this.notify('exit')
      } catch {
        // The transport may already be gone; terminating the worker still releases its resources.
      }
    }
    this.transport.close()
    this.documents.clear()
    this.rejectPending(new Error('Language server connection closed'))
  }

  private notify(method: string, params?: unknown) {
    if (!this.transport.ready) return
    this.send({
      jsonrpc: '2.0',
      method,
      ...(params === undefined ? {} : { params }),
    })
  }

  private request<T = unknown>(method: string, params: unknown): Promise<T> {
    const id = ++this.nextRequestId
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Language server request timed out'))
      }, 15_000)
      this.pending.set(id, {
        resolve: (value) => {
          window.clearTimeout(timer)
          resolve(value as T)
        },
        reject: (error) => {
          window.clearTimeout(timer)
          reject(error)
        },
      })
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        this.pending
          .get(id)
          ?.reject(
            error instanceof Error ? error : new Error('Connection failed'),
          )
        this.pending.delete(id)
      }
    })
  }

  private send(message: JsonRpcMessage) {
    if (!this.transport.ready) {
      throw new Error('Language server is not connected')
    }
    this.transport.send(message)
  }

  private async handleMessage(data: unknown) {
    if (!data || typeof data !== 'object') return
    const message = data as JsonRpcMessage

    if (message.method === 'textDocument/publishDiagnostics') {
      const params = message.params as {
        uri?: string
        diagnostics?: LspDiagnostic[]
        version?: number
      }
      if (params.uri) {
        const version = this.documents.get(params.uri)
        if (
          params.version !== undefined &&
          version !== undefined &&
          params.version < version
        )
          return
        for (const listener of this.diagnosticsListeners) {
          listener(params.uri, params.diagnostics ?? [])
        }
      }
      return
    }

    if (message.method && message.id !== undefined) {
      this.send({ jsonrpc: '2.0', id: message.id, result: null })
      return
    }

    if (typeof message.id === 'number') {
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      if (message.error) {
        request.reject(new Error(message.error.message))
      } else {
        request.resolve(message.result)
      }
    }
  }

  private rejectPending(error: Error) {
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
  }
}

export function programPathToUri(path: string) {
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `file:///workspace/${encodedPath}`
}

export function uriToProgramPath(uri: string) {
  const path = decodeURIComponent(new URL(uri).pathname)
  return path.replace(/^\/workspace\//, '')
}

export function languageIdForPath(path: string) {
  return path.toLowerCase().endsWith('.c') ? 'c' : 'cpp'
}
