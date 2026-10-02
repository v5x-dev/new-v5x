import type {
  ServerCapabilities,
  InitializeResult,
  ClientCapabilities,
  Diagnostic,
  CompletionItem,
  CompletionList,
  CompletionContext,
  Hover,
  Position,
  Range,
  Location,
  LocationLink,
  TextEdit,
  WorkspaceEdit,
  SignatureHelp,
  SignatureHelpContext,
  DocumentHighlight,
  DocumentSymbol,
  SymbolInformation,
  CodeAction,
  Command,
  CodeLens,
  DocumentLink,
  FoldingRange,
  SelectionRange,
  InlayHint,
  SemanticTokens,
  SemanticTokensDelta,
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
  TypeHierarchyItem,
  DocumentDiagnosticReport,
  WorkspaceDiagnosticReport,
  FormattingOptions,
  PrepareRenameResult,
  Registration,
  Unregistration,
} from 'vscode-languageserver-protocol'
import { BrowserLspTransport } from './browser-lsp-transport'
import { LspWorkspace, workspacePath } from './lsp-workspace'

export type LspPosition = Position
export type LspRange = Range
export type LspLocation = Location
export type LspDiagnostic = Diagnostic
export type LspCompletionItem = Omit<CompletionItem, 'textEdit'> & {
  textEdit?: TextEdit
}
export type {
  CodeAction,
  Command,
  SignatureHelp,
  DocumentSymbol,
  WorkspaceEdit,
}

type RpcMessage = {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}
type DiagnosticsListener = (uri: string, diagnostics: Diagnostic[]) => void
type RequestOptions = { signal?: AbortSignal; timeout?: number }
export type LspNotice = {
  type: number
  message: string
  actions?: { title: string }[]
  respond?: (action: { title: string } | null) => void
}
export type LspProgress = {
  token: string | number
  value: {
    kind?: string
    title?: string
    message?: string
    percentage?: number
    cancellable?: boolean
  }
}

const features: Record<string, keyof ServerCapabilities> = {
  completion: 'completionProvider',
  hover: 'hoverProvider',
  signatureHelp: 'signatureHelpProvider',
  definition: 'definitionProvider',
  declaration: 'declarationProvider',
  typeDefinition: 'typeDefinitionProvider',
  implementation: 'implementationProvider',
  references: 'referencesProvider',
  documentHighlight: 'documentHighlightProvider',
  documentSymbol: 'documentSymbolProvider',
  workspaceSymbol: 'workspaceSymbolProvider',
  codeAction: 'codeActionProvider',
  codeLens: 'codeLensProvider',
  documentLink: 'documentLinkProvider',
  formatting: 'documentFormattingProvider',
  rangeFormatting: 'documentRangeFormattingProvider',
  onTypeFormatting: 'documentOnTypeFormattingProvider',
  rename: 'renameProvider',
  foldingRange: 'foldingRangeProvider',
  selectionRange: 'selectionRangeProvider',
  linkedEditingRange: 'linkedEditingRangeProvider',
  callHierarchy: 'callHierarchyProvider',
  typeHierarchy: 'typeHierarchyProvider',
  inlayHint: 'inlayHintProvider',
  semanticTokens: 'semanticTokensProvider',
  diagnostic: 'diagnosticProvider',
  executeCommand: 'executeCommandProvider',
}

export function normalizeLocations(
  value: Location | Location[] | LocationLink[] | null,
): Location[] {
  if (!value) return []
  return (Array.isArray(value) ? value : [value]).map((location) =>
    'targetUri' in location
      ? { uri: location.targetUri, range: location.targetSelectionRange }
      : location,
  )
}

export class LanguageServerClient {
  readonly navigationHistory: { entries: Location[]; index: number } = {
    entries: [],
    index: -1,
  }
  capabilities: ServerCapabilities = {}
  serverInfo?: InitializeResult['serverInfo']
  readonly diagnostics = new Map<string, Diagnostic[]>()
  private nextRequestId = 0
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >()
  private diagnosticsListeners = new Set<DiagnosticsListener>()
  private disconnectListeners = new Set<() => void>()
  private noticeListeners = new Set<(notice: LspNotice) => void>()
  private progressListeners = new Set<(progress: LspProgress) => void>()
  private refreshListeners = new Set<(method: string) => void>()
  private registrations = new Map<string, Registration>()
  private documents = new Map<string, number>()
  private configuration: Record<string, unknown> = {}
  private closed = false
  private unsubscribeWorkspace?: () => void

  constructor(
    private readonly transport: BrowserLspTransport,
    readonly workspace = new LspWorkspace(),
  ) {}

  supports(feature: string) {
    if (this.capabilities[features[feature]]) return true
    const method =
      feature === 'workspaceSymbol'
        ? 'workspace/symbol'
        : `textDocument/${feature}`
    return [...this.registrations.values()].some(
      (registration) => registration.method === method,
    )
  }

  async connect() {
    this.transport.onMessage = (message) => {
      void this.handleMessage(message)
    }
    this.transport.onDisconnect = () => {
      this.rejectPending(new Error('C++ tools stopped'))
      if (!this.closed)
        for (const listener of this.disconnectListeners) listener()
    }
    await this.transport.start()
    const capabilities: ClientCapabilities = {
      general: { positionEncodings: ['utf-16'] },
      window: {
        workDoneProgress: true,
        showMessage: {
          messageActionItem: { additionalPropertiesSupport: true },
        },
      },
      workspace: {
        workspaceFolders: true,
        configuration: true,
        applyEdit: true,
        workspaceEdit: { documentChanges: true, normalizesLineEndings: false },
        symbol: {
          dynamicRegistration: true,
          resolveSupport: { properties: ['location.range'] },
        },
        executeCommand: { dynamicRegistration: true },
        semanticTokens: { refreshSupport: true },
        inlayHint: { refreshSupport: true },
        codeLens: { refreshSupport: true },
        diagnostics: { refreshSupport: true },
      },
      textDocument: {
        synchronization: { dynamicRegistration: true, didSave: true },
        completion: {
          dynamicRegistration: true,
          contextSupport: true,
          completionItem: {
            snippetSupport: true,
            commitCharactersSupport: true,
            deprecatedSupport: true,
            preselectSupport: true,
            documentationFormat: ['markdown', 'plaintext'],
            resolveSupport: {
              properties: [
                'documentation',
                'detail',
                'additionalTextEdits',
                'command',
              ],
            },
            labelDetailsSupport: true,
          },
        },
        signatureHelp: {
          dynamicRegistration: true,
          contextSupport: true,
          signatureInformation: {
            documentationFormat: ['markdown', 'plaintext'],
            parameterInformation: { labelOffsetSupport: true },
            activeParameterSupport: true,
          },
        },
        hover: {
          dynamicRegistration: true,
          contentFormat: ['markdown', 'plaintext'],
        },
        definition: { dynamicRegistration: true, linkSupport: true },
        declaration: { dynamicRegistration: true, linkSupport: true },
        implementation: { dynamicRegistration: true, linkSupport: true },
        typeDefinition: { dynamicRegistration: true, linkSupport: true },
        references: { dynamicRegistration: true },
        documentHighlight: { dynamicRegistration: true },
        documentSymbol: {
          dynamicRegistration: true,
          hierarchicalDocumentSymbolSupport: true,
          labelSupport: true,
        },
        codeAction: {
          dynamicRegistration: true,
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
          isPreferredSupport: true,
          disabledSupport: true,
          dataSupport: true,
          resolveSupport: { properties: ['edit', 'command'] },
        },
        codeLens: { dynamicRegistration: true },
        documentLink: { dynamicRegistration: true, tooltipSupport: true },
        formatting: { dynamicRegistration: true },
        rangeFormatting: { dynamicRegistration: true },
        onTypeFormatting: { dynamicRegistration: true },
        rename: {
          dynamicRegistration: true,
          prepareSupport: true,
          prepareSupportDefaultBehavior: 1,
        },
        publishDiagnostics: {
          relatedInformation: true,
          versionSupport: true,
          tagSupport: { valueSet: [1, 2] },
          codeDescriptionSupport: true,
          dataSupport: true,
        },
        foldingRange: {
          dynamicRegistration: true,
          lineFoldingOnly: true,
          foldingRangeKind: { valueSet: ['comment', 'imports', 'region'] },
          foldingRange: { collapsedText: true },
        },
        selectionRange: { dynamicRegistration: true },
        linkedEditingRange: { dynamicRegistration: true },
        callHierarchy: { dynamicRegistration: true },
        typeHierarchy: { dynamicRegistration: true },
        inlayHint: {
          dynamicRegistration: true,
          resolveSupport: {
            properties: [
              'tooltip',
              'textEdits',
              'label.tooltip',
              'label.location',
              'label.command',
            ],
          },
        },
        semanticTokens: {
          dynamicRegistration: true,
          requests: { full: { delta: true }, range: true },
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
            'label',
            'comment',
            'string',
            'keyword',
            'number',
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
          augmentsSyntaxTokens: true,
        },
        diagnostic: { dynamicRegistration: true, relatedDocumentSupport: true },
      },
    }
    const result = await this.request<InitializeResult>('initialize', {
      processId: null,
      clientInfo: { name: 'v5x code', version: '1.0.0' },
      rootUri: 'file:///workspace',
      workspaceFolders: [{ uri: 'file:///workspace', name: 'workspace' }],
      capabilities,
      initializationOptions: { clangdFileStatus: true, fallbackFlags: [] },
    })
    if (
      result.capabilities.positionEncoding &&
      result.capabilities.positionEncoding !== 'utf-16'
    )
      throw new Error(
        'The language server selected an unsupported position encoding',
      )
    this.capabilities = result.capabilities
    this.serverInfo = result.serverInfo
    this.notify('initialized', {})
    this.unsubscribeWorkspace = this.workspace.onChange((path) => {
      const file = this.workspace.get(path)!
      const uri = programPathToUri(path)
      if (this.documents.get(uri) === file.version) return
      if (this.documents.has(uri)) {
        this.documents.set(uri, file.version)
        this.notify('textDocument/didChange', {
          textDocument: { uri, version: file.version },
          contentChanges: [{ text: file.contents }],
        })
      } else if (file.contents !== file.savedContents)
        this.openDocument(path, file.contents)
      // clangd also reads included files directly from its local filesystem.
      void this.request('t3/updateFile', {
        path,
        contents: file.contents,
      }).catch(() => {})
    })
  }

  onDiagnostics(listener: DiagnosticsListener) {
    this.diagnosticsListeners.add(listener)
    return () => {
      this.diagnosticsListeners.delete(listener)
    }
  }
  onDisconnect(listener: () => void) {
    this.disconnectListeners.add(listener)
    return () => {
      this.disconnectListeners.delete(listener)
    }
  }
  onNotice(listener: (notice: LspNotice) => void) {
    this.noticeListeners.add(listener)
    return () => {
      this.noticeListeners.delete(listener)
    }
  }
  onProgress(listener: (progress: LspProgress) => void) {
    this.progressListeners.add(listener)
    return () => {
      this.progressListeners.delete(listener)
    }
  }
  onRefresh(listener: (method: string) => void) {
    this.refreshListeners.add(listener)
    return () => {
      this.refreshListeners.delete(listener)
    }
  }

  openDocument(path: string, text: string) {
    this.workspace.seed([{ path, contents: text }])
    const uri = programPathToUri(path)
    if (this.documents.has(uri)) {
      this.changeDocument(path, text)
      return
    }
    this.workspace.change(path, text)
    // A workspace notification may already have opened this dirty document.
    if (this.documents.has(uri)) return
    const file = this.workspace.get(path)!
    this.documents.set(uri, file.version)
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: languageIdForPath(path),
        version: file.version,
        text,
      },
    })
  }
  changeDocument(path: string, text: string) {
    this.workspace.seed([{ path, contents: text }])
    this.workspace.change(path, text)
  }
  closeDocument(path: string) {
    const file = this.workspace.get(path)
    if (file && file.contents !== file.savedContents) return
    const uri = programPathToUri(path)
    if (this.documents.delete(uri))
      this.notify('textDocument/didClose', { textDocument: { uri } })
  }
  async syncSavedFile(path: string, contents: string) {
    await this.request('t3/syncFile', { path, contents })
    this.workspace.markSaved(path, contents)
    this.notify('textDocument/didSave', {
      textDocument: { uri: programPathToUri(path) },
      text: contents,
    })
  }
  private document(path: string) {
    return { uri: path.startsWith('file:') ? path : programPathToUri(path) }
  }
  private at(path: string, position: Position) {
    return { textDocument: this.document(path), position }
  }
  feature<T>(
    feature: string,
    method: string,
    params: unknown,
    fallback: T,
    options?: RequestOptions,
  ): Promise<T> {
    return this.supports(feature)
      ? this.request<T>(method, params, options)
      : Promise.resolve(fallback)
  }
  async completion(
    path: string,
    position: Position,
    context?: CompletionContext,
    signal?: AbortSignal,
  ) {
    const result = await this.feature<CompletionList | CompletionItem[] | null>(
      'completion',
      'textDocument/completion',
      { ...this.at(path, position), context },
      null,
      { signal },
    )
    const items = !result ? [] : Array.isArray(result) ? result : result.items
    return items.map((item) => ({
      ...item,
      textEdit:
        item.textEdit && 'insert' in item.textEdit
          ? { range: item.textEdit.insert, newText: item.textEdit.newText }
          : item.textEdit,
    })) as LspCompletionItem[]
  }
  resolveCompletion(item: LspCompletionItem, signal?: AbortSignal) {
    return this.capabilities.completionProvider?.resolveProvider
      ? this.request<LspCompletionItem>('completionItem/resolve', item, {
          signal,
        })
      : Promise.resolve(item)
  }
  hover(path: string, position: Position, signal?: AbortSignal) {
    return this.feature<Hover | null>(
      'hover',
      'textDocument/hover',
      this.at(path, position),
      null,
      { signal },
    )
  }
  async locations(
    kind: 'definition' | 'declaration' | 'typeDefinition' | 'implementation',
    path: string,
    position: Position,
    signal?: AbortSignal,
  ) {
    return normalizeLocations(
      await this.feature<Location | Location[] | LocationLink[] | null>(
        kind,
        `textDocument/${kind}`,
        this.at(path, position),
        null,
        { signal },
      ),
    )
  }
  definition(path: string, position: Position, signal?: AbortSignal) {
    return this.locations('definition', path, position, signal)
  }
  references(
    path: string,
    position: Position,
    includeDeclaration = true,
    signal?: AbortSignal,
  ) {
    return this.feature<Location[] | null>(
      'references',
      'textDocument/references',
      { ...this.at(path, position), context: { includeDeclaration } },
      null,
      { signal },
    )
  }
  signatureHelp(
    path: string,
    position: Position,
    context?: SignatureHelpContext,
    signal?: AbortSignal,
  ) {
    return this.feature<SignatureHelp | null>(
      'signatureHelp',
      'textDocument/signatureHelp',
      { ...this.at(path, position), context },
      null,
      { signal },
    )
  }
  highlights(path: string, position: Position, signal?: AbortSignal) {
    return this.feature<DocumentHighlight[] | null>(
      'documentHighlight',
      'textDocument/documentHighlight',
      this.at(path, position),
      null,
      { signal },
    )
  }
  symbols(path: string, signal?: AbortSignal) {
    return this.feature<DocumentSymbol[] | SymbolInformation[] | null>(
      'documentSymbol',
      'textDocument/documentSymbol',
      { textDocument: this.document(path) },
      null,
      { signal },
    )
  }
  workspaceSymbols(query: string, signal?: AbortSignal) {
    return this.feature<SymbolInformation[] | null>(
      'workspaceSymbol',
      'workspace/symbol',
      { query },
      null,
      { signal },
    )
  }
  resolveWorkspaceSymbol(symbol: SymbolInformation) {
    return typeof this.capabilities.workspaceSymbolProvider === 'object' &&
      this.capabilities.workspaceSymbolProvider.resolveProvider
      ? this.request<SymbolInformation>('workspaceSymbol/resolve', symbol)
      : Promise.resolve(symbol)
  }
  codeActions(
    path: string,
    range: Range,
    diagnostics: Diagnostic[],
    only?: string[],
    signal?: AbortSignal,
  ) {
    return this.feature<(CodeAction | Command)[] | null>(
      'codeAction',
      'textDocument/codeAction',
      {
        textDocument: this.document(path),
        range,
        context: { diagnostics, only, triggerKind: 1 },
      },
      null,
      { signal },
    )
  }
  resolveCodeAction(action: CodeAction) {
    return typeof this.capabilities.codeActionProvider === 'object' &&
      this.capabilities.codeActionProvider.resolveProvider
      ? this.request<CodeAction>('codeAction/resolve', action)
      : Promise.resolve(action)
  }
  codeLenses(path: string, signal?: AbortSignal) {
    return this.feature<CodeLens[] | null>(
      'codeLens',
      'textDocument/codeLens',
      { textDocument: this.document(path) },
      null,
      { signal },
    )
  }
  resolveCodeLens(lens: CodeLens) {
    return this.capabilities.codeLensProvider?.resolveProvider
      ? this.request<CodeLens>('codeLens/resolve', lens)
      : Promise.resolve(lens)
  }
  links(path: string, signal?: AbortSignal) {
    return this.feature<DocumentLink[] | null>(
      'documentLink',
      'textDocument/documentLink',
      { textDocument: this.document(path) },
      null,
      { signal },
    )
  }
  resolveLink(link: DocumentLink) {
    return this.capabilities.documentLinkProvider?.resolveProvider
      ? this.request<DocumentLink>('documentLink/resolve', link)
      : Promise.resolve(link)
  }
  format(path: string, options: FormattingOptions, range?: Range) {
    return this.feature<TextEdit[] | null>(
      range ? 'rangeFormatting' : 'formatting',
      range ? 'textDocument/rangeFormatting' : 'textDocument/formatting',
      {
        textDocument: this.document(path),
        options,
        ...(range ? { range } : {}),
      },
      null,
    )
  }
  formatOnType(
    path: string,
    position: Position,
    ch: string,
    options: FormattingOptions,
  ) {
    return this.feature<TextEdit[] | null>(
      'onTypeFormatting',
      'textDocument/onTypeFormatting',
      { ...this.at(path, position), ch, options },
      null,
    )
  }
  prepareRename(path: string, position: Position) {
    return typeof this.capabilities.renameProvider === 'object' &&
      this.capabilities.renameProvider.prepareProvider
      ? this.request<PrepareRenameResult | null>(
          'textDocument/prepareRename',
          this.at(path, position),
        )
      : Promise.resolve(null)
  }
  rename(path: string, position: Position, newName: string) {
    return this.feature<WorkspaceEdit | null>(
      'rename',
      'textDocument/rename',
      { ...this.at(path, position), newName },
      null,
    )
  }
  foldingRanges(path: string, signal?: AbortSignal) {
    return this.feature<FoldingRange[] | null>(
      'foldingRange',
      'textDocument/foldingRange',
      { textDocument: this.document(path) },
      null,
      { signal },
    )
  }
  selectionRanges(path: string, positions: Position[], signal?: AbortSignal) {
    return this.feature<SelectionRange[] | null>(
      'selectionRange',
      'textDocument/selectionRange',
      { textDocument: this.document(path), positions },
      null,
      { signal },
    )
  }
  linkedEditing(path: string, position: Position, signal?: AbortSignal) {
    return this.feature<{ ranges: Range[]; wordPattern?: string } | null>(
      'linkedEditingRange',
      'textDocument/linkedEditingRange',
      this.at(path, position),
      null,
      { signal },
    )
  }
  prepareCallHierarchy(path: string, position: Position) {
    return this.feature<CallHierarchyItem[] | null>(
      'callHierarchy',
      'textDocument/prepareCallHierarchy',
      this.at(path, position),
      null,
    )
  }
  incomingCalls(item: CallHierarchyItem) {
    return this.feature<CallHierarchyIncomingCall[] | null>(
      'callHierarchy',
      'callHierarchy/incomingCalls',
      { item },
      null,
    )
  }
  outgoingCalls(item: CallHierarchyItem) {
    return this.feature<CallHierarchyOutgoingCall[] | null>(
      'callHierarchy',
      'callHierarchy/outgoingCalls',
      { item },
      null,
    )
  }
  prepareTypeHierarchy(path: string, position: Position) {
    return this.feature<TypeHierarchyItem[] | null>(
      'typeHierarchy',
      'textDocument/prepareTypeHierarchy',
      this.at(path, position),
      null,
    )
  }
  supertypes(item: TypeHierarchyItem) {
    return this.feature<TypeHierarchyItem[] | null>(
      'typeHierarchy',
      'typeHierarchy/supertypes',
      { item },
      null,
    )
  }
  subtypes(item: TypeHierarchyItem) {
    return this.feature<TypeHierarchyItem[] | null>(
      'typeHierarchy',
      'typeHierarchy/subtypes',
      { item },
      null,
    )
  }
  inlayHints(path: string, range: Range, signal?: AbortSignal) {
    return this.feature<InlayHint[] | null>(
      'inlayHint',
      'textDocument/inlayHint',
      { textDocument: this.document(path), range },
      null,
      { signal },
    )
  }
  resolveInlayHint(hint: InlayHint) {
    return typeof this.capabilities.inlayHintProvider === 'object' &&
      this.capabilities.inlayHintProvider.resolveProvider
      ? this.request<InlayHint>('inlayHint/resolve', hint)
      : Promise.resolve(hint)
  }
  semanticTokens(
    path: string,
    previousResultId?: string,
    signal?: AbortSignal,
  ) {
    return this.feature<SemanticTokens | SemanticTokensDelta | null>(
      'semanticTokens',
      previousResultId
        ? 'textDocument/semanticTokens/full/delta'
        : 'textDocument/semanticTokens/full',
      {
        textDocument: this.document(path),
        ...(previousResultId ? { previousResultId } : {}),
      },
      null,
      { signal },
    )
  }
  rangeSemanticTokens(path: string, range: Range, signal?: AbortSignal) {
    return this.feature<SemanticTokens | null>(
      'semanticTokens',
      'textDocument/semanticTokens/range',
      { textDocument: this.document(path), range },
      null,
      { signal },
    )
  }
  documentDiagnostics(
    path: string,
    previousResultId?: string,
    signal?: AbortSignal,
  ) {
    return this.feature<DocumentDiagnosticReport | null>(
      'diagnostic',
      'textDocument/diagnostic',
      { textDocument: this.document(path), previousResultId },
      null,
      { signal },
    )
  }
  workspaceDiagnostics(
    previousResultIds: { uri: string; value: string }[] = [],
    signal?: AbortSignal,
  ) {
    return this.feature<WorkspaceDiagnosticReport | null>(
      'diagnostic',
      'workspace/diagnostic',
      { previousResultIds },
      null,
      { signal },
    )
  }
  execute(command: Command) {
    return this.feature<unknown>(
      'executeCommand',
      'workspace/executeCommand',
      { command: command.command, arguments: command.arguments },
      null,
    )
  }
  applyEdit(edit: WorkspaceEdit) {
    this.workspace.apply(edit)
  }
  publishDiagnostics(uri: string, diagnostics: Diagnostic[]) {
    this.publish(uri, diagnostics)
  }
  configure(configuration: Record<string, unknown>) {
    this.configuration = configuration
    this.notify('workspace/didChangeConfiguration', { settings: configuration })
  }
  cancelProgress(token: string | number) {
    this.notify('window/workDoneProgress/cancel', { token })
  }
  readSdkFile(uri: string, signal?: AbortSignal) {
    const url = new URL(uri)
    if (
      url.protocol !== 'file:' ||
      url.host ||
      !url.pathname.startsWith('/sdk/')
    )
      return Promise.reject(new Error('Invalid SDK definition'))
    return this.request<string>(
      't3/readSdkFile',
      { path: decodeURIComponent(url.pathname) },
      { signal },
    )
  }
  async readSource(uri: string, signal?: AbortSignal) {
    if (uri.startsWith('file:///sdk/')) return this.readSdkFile(uri, signal)
    const file = this.workspace.get(workspacePath(uri))
    if (!file) throw new Error('Source file is not part of this project')
    return file.contents
  }

  async dispose() {
    if (this.closed) return
    this.closed = true
    this.unsubscribeWorkspace?.()
    if (this.transport.ready) {
      for (const uri of this.documents.keys())
        this.notify('textDocument/didClose', { textDocument: { uri } })
      try {
        await this.request('shutdown', null, { timeout: 1000 })
        this.notify('exit')
      } catch {
        /* Terminate even when clangd is busy. */
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
  private request<T = unknown>(
    method: string,
    params: unknown,
    { signal, timeout = 30_000 }: RequestOptions = {},
  ): Promise<T> {
    if (signal?.aborted)
      return Promise.reject(new DOMException('Request cancelled', 'AbortError'))
    const id = ++this.nextRequestId
    return new Promise<T>((resolve, reject) => {
      const finish = () => {
        window.clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        this.pending.delete(id)
      }
      const abort = () => {
        this.notify('$/cancelRequest', { id })
        finish()
        reject(new DOMException('Request cancelled', 'AbortError'))
      }
      const timer = window.setTimeout(() => {
        this.notify('$/cancelRequest', { id })
        finish()
        reject(new Error(`Language server request timed out: ${method}`))
      }, timeout)
      this.pending.set(id, {
        resolve: (value) => {
          finish()
          resolve(value as T)
        },
        reject: (error) => {
          finish()
          reject(error)
        },
      })
      signal?.addEventListener('abort', abort, { once: true })
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        this.pending
          .get(id)
          ?.reject(
            error instanceof Error ? error : new Error('Connection failed'),
          )
      }
    })
  }
  private send(message: RpcMessage) {
    if (!this.transport.ready)
      throw new Error('Language server is not connected')
    this.transport.send(message)
  }
  private publish(uri: string, diagnostics: Diagnostic[]) {
    this.diagnostics.set(uri, diagnostics)
    for (const listener of this.diagnosticsListeners) listener(uri, diagnostics)
  }
  private async handleMessage(data: unknown) {
    if (!data || typeof data !== 'object') return
    const message = data as RpcMessage
    if (!message.method) {
      if (typeof message.id !== 'number') return
      const pending = this.pending.get(message.id)
      if (message.error) pending?.reject(new Error(message.error.message))
      else pending?.resolve(message.result)
      return
    }
    const params = message.params as Record<string, unknown> | undefined
    if (message.method === 'textDocument/publishDiagnostics') {
      const value = params as {
        uri: string
        diagnostics: Diagnostic[]
        version?: number
      }
      if (!value?.uri) return
      const version = this.documents.get(value.uri)
      if (
        value.version !== undefined &&
        version !== undefined &&
        value.version < version
      )
        return
      this.publish(value.uri, value.diagnostics ?? [])
      return
    }
    if (message.method === '$/progress') {
      for (const listener of this.progressListeners)
        listener(params as unknown as LspProgress)
      return
    }
    if (
      message.method === 'window/showMessage' ||
      message.method === 'window/logMessage'
    ) {
      if (message.method === 'window/showMessage')
        for (const listener of this.noticeListeners)
          listener(params as unknown as LspNotice)
      return
    }
    if (message.id === undefined) return
    const reply = (result: unknown) =>
      this.send({ jsonrpc: '2.0', id: message.id, result })
    try {
      switch (message.method) {
        case 'workspace/configuration':
          reply(
            ((params?.items as { section?: string }[]) ?? []).map((item) =>
              item.section
                ? (item.section
                    .split('.')
                    .reduce<unknown>(
                      (value, part) =>
                        value && typeof value === 'object'
                          ? (value as Record<string, unknown>)[part]
                          : undefined,
                      this.configuration,
                    ) ?? null)
                : this.configuration,
            ),
          )
          return
        case 'workspace/workspaceFolders':
          reply([{ uri: 'file:///workspace', name: 'workspace' }])
          return
        case 'workspace/applyEdit':
          try {
            this.applyEdit(params?.edit as WorkspaceEdit)
            reply({ applied: true })
          } catch (error) {
            reply({
              applied: false,
              failureReason:
                error instanceof Error ? error.message : 'Could not apply edit',
            })
          }
          return
        case 'client/registerCapability':
          for (const registration of (params?.registrations as Registration[]) ??
            [])
            this.registrations.set(registration.id, registration)
          reply(null)
          return
        case 'client/unregisterCapability':
          for (const registration of ((params?.unregisterations ??
            params?.unregistrations) as Unregistration[]) ?? [])
            this.registrations.delete(registration.id)
          reply(null)
          return
        case 'window/workDoneProgress/create':
          reply(null)
          return
        case 'window/showMessageRequest': {
          const notice = params as unknown as LspNotice
          if (!this.noticeListeners.size) {
            reply(null)
            return
          }
          let responded = false
          const respond = (action: { title: string } | null) => {
            if (!responded) {
              responded = true
              reply(action)
            }
          }
          for (const listener of this.noticeListeners)
            listener({ ...notice, respond })
          return
        }
        case 'workspace/semanticTokens/refresh':
        case 'workspace/inlayHint/refresh':
        case 'workspace/codeLens/refresh':
        case 'workspace/diagnostic/refresh':
          for (const listener of this.refreshListeners) listener(message.method)
          reply(null)
          return
        default:
          this.send({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32601,
              message: `Unsupported client request: ${message.method}`,
            },
          })
          return
      }
    } catch (error) {
      this.send({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message:
            error instanceof Error ? error.message : 'Client request failed',
        },
      })
    }
  }
  private rejectPending(error: Error) {
    for (const request of [...this.pending.values()]) request.reject(error)
    this.pending.clear()
  }
}

export function programPathToUri(path: string) {
  return `file:///workspace/${path.split('/').map(encodeURIComponent).join('/')}`
}
export function uriToProgramPath(uri: string) {
  return workspacePath(uri)
}
export function languageIdForPath(path: string) {
  return path.toLowerCase().endsWith('.c') ? 'c' : 'cpp'
}
