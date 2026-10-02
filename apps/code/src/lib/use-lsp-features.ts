import * as React from 'react'
import type { Editor } from '@pierre/diffs/edit'
import type {
  CodeAction,
  Command,
  CallHierarchyItem,
  TypeHierarchyItem,
  DocumentSymbol,
  SymbolInformation,
  Location,
  Range,
  WorkspaceEdit,
  SignatureHelp,
  InlayHint,
  SemanticTokens,
  CodeLens,
  FoldingRange,
  DocumentLink,
  DocumentHighlight,
} from 'vscode-languageserver-protocol'
import {
  LanguageServerClient,
  programPathToUri,
  type LspNotice,
  type LspProgress,
} from './language-server-client'
import { cppSymbolAt } from './cpp-symbol'
import { textOffset } from './lsp-workspace'

export type FeatureItem = {
  label: string
  detail?: string
  location?: Location
  disabled?: string
  action?: () => void | Promise<void>
  children?: () => Promise<FeatureItem[]>
}
export type FeaturePanel = {
  title: string
  loading: boolean
  items: FeatureItem[]
  error?: string
  search?: (query: string) => void
}
type Preview = {
  title: string
  edit: WorkspaceEdit
  changes: ReturnType<LanguageServerClient['workspace']['preview']>
}
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Language operation failed'

function symbolItems(
  symbols: DocumentSymbol[] | SymbolInformation[],
  uri: string,
  depth = 0,
): FeatureItem[] {
  return symbols.flatMap((symbol) =>
    'location' in symbol
      ? [
          {
            label: symbol.name,
            detail: symbol.containerName,
            location: symbol.location,
          },
        ]
      : [
          {
            label: `${'  '.repeat(depth)}${symbol.name}`,
            detail: symbol.detail,
            location: { uri, range: symbol.selectionRange },
          },
          ...symbolItems(symbol.children ?? [], uri, depth + 1),
        ],
  )
}

export function useLspFeatures({
  client,
  path,
  editorRef,
  onNavigate,
}: {
  client: LanguageServerClient | null
  path: string
  editorRef: React.RefObject<Editor | null>
  onNavigate: (location: Location) => void
}) {
  const [panel, setPanel] = React.useState<FeaturePanel | null>(null)
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [rename, setRename] = React.useState<{
    value: string
    position: { line: number; character: number }
    version: number
    loading: boolean
    error?: string
  } | null>(null)
  const [signature, setSignature] = React.useState<SignatureHelp | null>(null)
  const [notice, setNotice] = React.useState<LspNotice | null>(null)
  const [progress, setProgress] = React.useState<
    Map<string | number, LspProgress['value']>
  >(new Map())
  const [decorations, setDecorations] = React.useState<{
    text: string
    hints: InlayHint[]
    tokens: SemanticTokens | null
    lenses: CodeLens[]
    folds: FoldingRange[]
    links: DocumentLink[]
    highlights: DocumentHighlight[]
  }>({
    text: '',
    hints: [],
    tokens: null,
    lenses: [],
    folds: [],
    links: [],
    highlights: [],
  })
  const [revision, refresh] = React.useReducer((n) => n + 1, 0)
  const [semanticEnabled, setSemanticEnabled] = React.useState(true)
  const controllers = React.useRef(new Map<string, AbortController>())
  const panelVersion = React.useRef(0)
  const signatureRef = React.useRef<SignatureHelp | null>(null)
  const signatureVersion = React.useRef(0)
  const selectionStack = React.useRef<Range[]>([])

  const signalFor = React.useCallback((key: string) => {
    controllers.current.get(key)?.abort()
    const controller = new AbortController()
    controllers.current.set(key, controller)
    return controller.signal
  }, [])
  const cursor = () => {
    const selection = editorRef.current?.getViewState().selections?.[0]
    return selection?.direction === -1 ? selection.start : selection?.end
  }
  const range = () => {
    const selection = editorRef.current?.getViewState().selections?.[0]
    return selection ? { start: selection.start, end: selection.end } : null
  }
  const fail = (error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') return
    setNotice({ type: 1, message: errorText(error) })
  }
  const closePanel = () => {
    panelVersion.current++
    controllers.current.get('panel')?.abort()
    setPanel(null)
    editorRef.current?.focus()
  }
  const show = async (
    title: string,
    load: (signal: AbortSignal) => Promise<FeatureItem[]>,
    search?: (query: string) => void,
  ) => {
    const version = ++panelVersion.current
    const signal = signalFor('panel')
    setPanel({ title, loading: true, items: [], search })
    try {
      const items = await load(signal)
      if (version === panelVersion.current && !signal.aborted)
        setPanel({ title, loading: false, items, search })
    } catch (error) {
      if (version === panelVersion.current && !signal.aborted)
        setPanel({
          title,
          loading: false,
          items: [],
          error: errorText(error),
          search,
        })
    }
  }
  const navigate = (location: Location, record = true) => {
    if (record) {
      const position = cursor()
      if (position && client) {
        const history = client.navigationHistory
        history.entries = history.entries.slice(0, history.index + 1)
        history.entries.push(
          {
            uri: programPathToUri(path),
            range: { start: position, end: position },
          },
          location,
        )
        history.index = history.entries.length - 1
      }
    }
    setPanel(null)
    onNavigate(location)
  }
  const goHistory = (direction: number) => {
    if (!client) return
    const history = client.navigationHistory
    const next = history.index + direction
    if (next < 0 || next >= history.entries.length) return
    history.index = next
    onNavigate(history.entries[next])
  }
  const showLocations = (title: string, locations: Location[]) => {
    void show(title, async () =>
      locations.map((location) => ({
        label: decodeURIComponent(new URL(location.uri).pathname),
        detail: `${location.range.start.line + 1}:${location.range.start.character + 1}`,
        location,
      })),
    )
  }
  const navigation = async (
    kind: 'definition' | 'declaration' | 'typeDefinition' | 'implementation',
    peek = false,
  ) => {
    const position = cursor()
    if (!client || !position) return
    const symbol = cppSymbolAt(editorRef.current!.getText(), position)
    if (!symbol) return
    await show(peek ? `Peek ${kind}` : `Go to ${kind}`, async (signal) => {
      const locations = await client.locations(kind, path, symbol, signal)
      if (locations.length === 1 && !peek) {
        navigate(locations[0])
        panelVersion.current++
        return []
      }
      return locations.map((location) => ({
        label: decodeURIComponent(new URL(location.uri).pathname),
        detail: `${location.range.start.line + 1}:${location.range.start.character + 1}`,
        location,
      }))
    })
  }
  const showReferences = async () => {
    const position = cursor()
    if (!client || !position) return
    await show('References', async (signal) =>
      ((await client.references(path, position, true, signal)) ?? []).map(
        (location) => ({
          label: decodeURIComponent(new URL(location.uri).pathname),
          detail: `${location.range.start.line + 1}:${location.range.start.character + 1}`,
          location,
        }),
      ),
    )
  }
  const showSymbols = () => {
    if (!client) return
    void show('Go to Symbol in Editor', async (signal) =>
      symbolItems(
        (await client.symbols(path, signal)) ?? [],
        programPathToUri(path),
      ),
    )
  }
  const showWorkspaceSymbols = (query = '') => {
    if (!client) return
    void show(
      'Go to Symbol in Workspace',
      async (signal) =>
        ((await client.workspaceSymbols(query, signal)) ?? []).map(
          (symbol) => ({
            label: symbol.name,
            detail: symbol.containerName,
            action: async () => {
              const resolved = await client.resolveWorkspaceSymbol(symbol)
              if (resolved.location.range) navigate(resolved.location)
            },
          }),
        ),
      showWorkspaceSymbols,
    )
  }
  const showProblems = () => {
    if (!client) return
    void show('Problems', async () =>
      [...client.diagnostics].flatMap(([uri, diagnostics]) =>
        diagnostics.map((diagnostic) => ({
          label:
            typeof diagnostic.message === 'string'
              ? diagnostic.message
              : diagnostic.message.value,
          detail: `${decodeURIComponent(new URL(uri).pathname)}:${diagnostic.range.start.line + 1} · C++${diagnostic.code === undefined ? '' : ` (${diagnostic.code})`}`,
          location: { uri, range: diagnostic.range },
          children: diagnostic.relatedInformation?.length
            ? async () =>
                diagnostic.relatedInformation!.map((info) => ({
                  label: info.message,
                  location: info.location,
                }))
            : undefined,
        })),
      ),
    )
  }
  const nextProblem = (backwards = false) => {
    if (!client) return
    const problems = client.diagnostics.get(programPathToUri(path)) ?? []
    const position = cursor()
    if (!position || !problems.length) return
    const sorted = [...problems].sort(
      (a, b) =>
        a.range.start.line - b.range.start.line ||
        a.range.start.character - b.range.start.character,
    )
    const after = sorted.findIndex(
      (problem) =>
        problem.range.start.line > position.line ||
        (problem.range.start.line === position.line &&
          problem.range.start.character > position.character),
    )
    let before = -1
    sorted.forEach((problem, index) => {
      if (
        problem.range.start.line < position.line ||
        (problem.range.start.line === position.line &&
          problem.range.start.character < position.character)
      )
        before = index
    })
    const problem =
      sorted[
        backwards
          ? before < 0
            ? sorted.length - 1
            : before
          : after < 0
            ? 0
            : after
      ]
    editorRef.current?.focus({
      lineNumber: problem.range.start.line + 1,
      character: problem.range.start.character,
    })
    setNotice({
      type: problem.severity ?? 1,
      message:
        typeof problem.message === 'string'
          ? problem.message
          : problem.message.value,
    })
  }
  const previewEdit = (title: string, edit: WorkspaceEdit) => {
    if (!client) return
    setPreview({ title, edit, changes: client.workspace.preview(edit) })
  }
  const applyPreview = () => {
    if (!client || !preview) return
    try {
      if (
        preview.changes.some(
          (change) =>
            client.workspace.get(change.path)?.contents !== change.before,
        )
      )
        throw new Error(
          'A file changed after this preview opened. Run the command again.',
        )
      client.applyEdit(preview.edit)
      setPreview(null)
      editorRef.current?.focus()
      refresh()
    } catch (error) {
      fail(error)
    }
  }
  const showRename = async () => {
    const position = cursor()
    if (!client || !position) return
    const symbol = cppSymbolAt(editorRef.current!.getText(), position)
    if (!symbol) return
    const file = client.workspace.get(path)!
    let value =
      /^\w+/.exec(
        file.contents.split('\n')[symbol.line].slice(symbol.character),
      )?.[0] ?? ''
    setRename({ value, position: symbol, version: file.version, loading: true })
    try {
      const prepared = await client.prepareRename(path, symbol)
      if (
        typeof client.capabilities.renameProvider === 'object' &&
        client.capabilities.renameProvider.prepareProvider &&
        !prepared
      )
        throw new Error('This symbol cannot be renamed')
      if (prepared && 'placeholder' in prepared) value = prepared.placeholder
      else if (prepared && 'start' in prepared)
        value = file.contents.slice(
          textOffset(file.contents, prepared.start),
          textOffset(file.contents, prepared.end),
        )
      setRename((current) =>
        current ? { ...current, value, loading: false } : null,
      )
    } catch (error) {
      setRename((current) =>
        current
          ? { ...current, loading: false, error: errorText(error) }
          : null,
      )
    }
  }
  const commitRename = async (newName: string, previewChanges: boolean) => {
    if (!client || !rename) return
    if (!/^[a-zA-Z_]\w*$/.test(newName)) {
      setRename({ ...rename, error: 'Enter a valid C++ identifier' })
      return
    }
    if (client.workspace.get(path)?.version !== rename.version) {
      setRename({ ...rename, error: 'The file changed. Run Rename again.' })
      return
    }
    setRename({ ...rename, loading: true, error: undefined })
    try {
      const edit = await client.rename(path, rename.position, newName)
      if (!edit) throw new Error('The server did not return a rename edit')
      if (client.workspace.get(path)?.version !== rename.version)
        throw new Error('The file changed while rename was being prepared')
      if (previewChanges) previewEdit(`Rename to ${newName}`, edit)
      else client.applyEdit(edit)
      setRename(null)
      if (!previewChanges) editorRef.current?.focus()
      refresh()
    } catch (error) {
      setRename((current) =>
        current
          ? { ...current, loading: false, error: errorText(error) }
          : null,
      )
    }
  }
  const applyAction = async (
    action: CodeAction | Command,
    previewChanges = false,
  ) => {
    if (!client) return
    try {
      if ('command' in action && typeof action.command === 'string')
        await client.execute(action as Command)
      else {
        const resolved = await client.resolveCodeAction(action as CodeAction)
        if (resolved.disabled) throw new Error(resolved.disabled.reason)
        if (resolved.edit) {
          if (previewChanges) {
            previewEdit(resolved.title, resolved.edit)
            return
          }
          client.applyEdit(resolved.edit)
        }
        if (resolved.command) await client.execute(resolved.command)
      }
      setPanel(null)
      editorRef.current?.focus()
      refresh()
    } catch (error) {
      fail(error)
    }
  }
  const showActions = (only?: string[]) => {
    const selection = range()
    if (!client || !selection) return
    const diagnostics = (
      client.diagnostics.get(programPathToUri(path)) ?? []
    ).filter(
      (diagnostic) =>
        diagnostic.range.start.line <= selection.end.line &&
        diagnostic.range.end.line >= selection.start.line,
    )
    void show(
      only?.[0] === 'refactor' ? 'Refactor' : 'Code Actions',
      async (signal) =>
        (
          (await client.codeActions(
            path,
            selection,
            diagnostics,
            only,
            signal,
          )) ?? []
        ).map((action) => ({
          label: action.title,
          detail: 'kind' in action ? action.kind : undefined,
          disabled: 'disabled' in action ? action.disabled?.reason : undefined,
          action: () => applyAction(action),
          children:
            'edit' in action && action.edit
              ? async () => [
                  {
                    label: 'Preview changes',
                    action: () => applyAction(action, true),
                  },
                ]
              : undefined,
        })),
    )
  }
  const format = async (selectionOnly = false) => {
    if (!client || !editorRef.current) return
    const text = editorRef.current.getText()
    const selection = selectionOnly ? range() : undefined
    if (selectionOnly && !selection) return
    try {
      const edits = await client.format(
        path,
        { tabSize: 2, insertSpaces: true },
        selection ?? undefined,
      )
      if (editorRef.current?.getText() !== text)
        throw new Error('The file changed while formatting. Try again.')
      if (edits?.length) editorRef.current.applyEdits(edits)
      refresh()
    } catch (error) {
      fail(error)
    }
  }
  const requestSignature = async (trigger?: string, manual = false) => {
    const position = cursor()
    if (!client || !position || !client.supports('signatureHelp')) return
    const version = ++signatureVersion.current
    const signal = signalFor('signature')
    const text = editorRef.current!.getText()
    try {
      const result = await client.signatureHelp(
        path,
        position,
        {
          triggerKind: manual ? 1 : trigger ? 2 : 3,
          triggerCharacter: trigger,
          isRetrigger: !!signatureRef.current,
          activeSignatureHelp: signatureRef.current ?? undefined,
        },
        signal,
      )
      if (
        version !== signatureVersion.current ||
        signal.aborted ||
        editorRef.current?.getText() !== text
      )
        return
      signatureRef.current = result
      setSignature(result)
    } catch (error) {
      if (!signal.aborted) {
        signatureRef.current = null
        setSignature(null)
      }
    }
  }
  const hideSignature = () => {
    signatureVersion.current++
    controllers.current.get('signature')?.abort()
    signatureRef.current = null
    setSignature(null)
  }
  const changeSignature = (direction: number) => {
    setSignature((current) => {
      if (!current) return null
      const next = {
        ...current,
        activeSignature:
          ((current.activeSignature ?? 0) +
            direction +
            current.signatures.length) %
          current.signatures.length,
      }
      signatureRef.current = next
      return next
    })
  }
  const expandSelection = async (shrink = false) => {
    const selection = range()
    const position = cursor()
    if (!client || !editorRef.current || !selection || !position) return
    if (shrink) {
      const previous = selectionStack.current.pop()
      if (previous)
        editorRef.current.setSelections([{ ...previous, direction: 'forward' }])
      return
    }
    try {
      let candidate = (
        await client.selectionRanges(path, [position], signalFor('selection'))
      )?.[0]
      const text = editorRef.current.getText()
      const start = textOffset(text, selection.start),
        end = textOffset(text, selection.end)
      while (
        candidate &&
        textOffset(text, candidate.range.start) >= start &&
        textOffset(text, candidate.range.end) <= end
      )
        candidate = candidate.parent
      if (candidate) {
        selectionStack.current.push(selection)
        editorRef.current.setSelections([
          { ...candidate.range, direction: 'forward' },
        ])
      }
    } catch (error) {
      fail(error)
    }
  }
  const showCallHierarchy = async (outgoing = false) => {
    const position = cursor()
    if (!client || !position) return
    const expand = async (item: CallHierarchyItem): Promise<FeatureItem[]> =>
      (outgoing
        ? ((await client.outgoingCalls(item)) ?? []).map((call) => ({
            item: call.to,
            ranges: call.fromRanges,
          }))
        : ((await client.incomingCalls(item)) ?? []).map((call) => ({
            item: call.from,
            ranges: call.fromRanges,
          }))
      ).map((call) => ({
        label: call.item.name,
        detail: call.item.detail,
        location: { uri: call.item.uri, range: call.item.selectionRange },
        children: () => expand(call.item),
      }))
    await show(outgoing ? 'Outgoing Calls' : 'Incoming Calls', async () => {
      const items = (await client.prepareCallHierarchy(path, position)) ?? []
      return (await Promise.all(items.map(expand))).flat()
    })
  }
  const showTypeHierarchy = async (subtypes = false) => {
    const position = cursor()
    if (!client || !position) return
    const expand = async (item: TypeHierarchyItem): Promise<FeatureItem[]> =>
      (
        (await (subtypes ? client.subtypes(item) : client.supertypes(item))) ??
        []
      ).map((type) => ({
        label: type.name,
        detail: type.detail,
        location: { uri: type.uri, range: type.selectionRange },
        children: () => expand(type),
      }))
    await show(subtypes ? 'Subtypes' : 'Supertypes', async () =>
      ((await client.prepareTypeHierarchy(path, position)) ?? []).map(
        (type) => ({
          label: type.name,
          detail: type.detail,
          location: { uri: type.uri, range: type.selectionRange },
          children: () => expand(type),
        }),
      ),
    )
  }
  const executeLens = async (lens: CodeLens) => {
    if (!client) return
    try {
      const resolved = await client.resolveCodeLens(lens)
      if (resolved.command) await client.execute(resolved.command)
    } catch (error) {
      fail(error)
    }
  }
  const showCodeLenses = () => {
    if (!client) return
    void show('Code Lens', async (signal) =>
      ((await client.codeLenses(path, signal)) ?? []).map((lens) => ({
        label:
          lens.command?.title ?? `Action at line ${lens.range.start.line + 1}`,
        action: () => executeLens(lens),
      })),
    )
  }
  const linkedEditing = async () => {
    const position = cursor()
    if (!client || !position) return
    try {
      const result = await client.linkedEditing(
        path,
        position,
        signalFor('linkedEditing'),
      )
      if (result?.ranges.length)
        editorRef.current?.setSelections(
          result.ranges.map((range) => ({ ...range, direction: 'forward' })),
        )
    } catch (error) {
      fail(error)
    }
  }

  React.useEffect(() => {
    if (!client) return
    const unsubscribes = [
      client.onNotice(setNotice),
      client.onProgress(({ token, value }) =>
        setProgress((current) => {
          const next = new Map(current)
          if (value.kind === 'end') next.delete(token)
          else next.set(token, { ...next.get(token), ...value })
          return next
        }),
      ),
      client.onRefresh(refresh),
    ]
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  }, [client])
  React.useEffect(() => {
    return () => {
      for (const controller of controllers.current.values()) controller.abort()
      panelVersion.current++
      signatureVersion.current++
    }
  }, [client, path])
  React.useEffect(() => {
    setPanel(null)
    setPreview(null)
    setRename(null)
    setSignature(null)
    signatureRef.current = null
    selectionStack.current = []
  }, [path])
  React.useEffect(() => {
    if (!client) return
    const signal = signalFor('decorations')
    const timer = window.setTimeout(async () => {
      const editor = editorRef.current
      if (!editor) return
      const text = editor.getText()
      const position = cursor()
      const results = await Promise.allSettled([
        Promise.resolve([]),
        semanticEnabled &&
        typeof client.capabilities.semanticTokensProvider === 'object' &&
        client.capabilities.semanticTokensProvider.full
          ? client.semanticTokens(path, undefined, signal)
          : Promise.resolve(null),
        client.codeLenses(path, signal),
        client.foldingRanges(path, signal),
        client.links(path, signal),
        position
          ? client.highlights(path, position, signal)
          : Promise.resolve([]),
        client.documentDiagnostics(path, undefined, signal),
      ])
      if (signal.aborted || editor.getText() !== text) return
      const value = <T>(index: number, fallback: T): T =>
        results[index].status === 'fulfilled'
          ? ((results[index] as PromiseFulfilledResult<T>).value ?? fallback)
          : fallback
      const tokens = value<SemanticTokens | null>(1, null)
      setDecorations({
        text,
        hints: value(0, []),
        tokens: tokens && 'data' in tokens ? tokens : null,
        lenses: value(2, []),
        folds: value(3, []),
        links: value(4, []),
        highlights: value(5, []),
      })
      const diagnostic = value<
        import('vscode-languageserver-protocol').DocumentDiagnosticReport | null
      >(6, null)
      if (diagnostic?.kind === 'full') {
        client.publishDiagnostics(programPathToUri(path), diagnostic.items)
      }
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controllers.current.get('decorations')?.abort()
    }
  }, [client, path, revision, semanticEnabled])

  const afterEdit = (inserted?: string) => {
    refresh()
    selectionStack.current = []
    const triggers = client?.capabilities.signatureHelpProvider
      ?.triggerCharacters ?? ['(', ',']
    const retriggers = client?.capabilities.signatureHelpProvider
      ?.retriggerCharacters ?? [')']
    const ch = inserted?.at(-1)
    if (
      signatureRef.current ||
      (ch && [...triggers, ...retriggers].includes(ch))
    )
      void requestSignature(ch)
  }
  return {
    panel,
    closePanel,
    preview,
    applyPreview,
    closePreview: () => {
      setPreview(null)
      editorRef.current?.focus()
    },
    rename,
    closeRename: () => {
      setRename(null)
      editorRef.current?.focus()
    },
    commitRename,
    signature,
    requestSignature,
    hideSignature,
    changeSignature,
    notice,
    dismissNotice: () => {
      notice?.respond?.(null)
      setNotice(null)
    },
    progress,
    decorations,
    afterEdit,
    refresh,
    navigate,
    goHistory,
    showLocations,
    navigation,
    showReferences,
    showSymbols,
    showWorkspaceSymbols,
    showProblems,
    nextProblem,
    showActions,
    showRename,
    format,
    expandSelection,
    showCallHierarchy,
    showTypeHierarchy,
    executeLens,
    showCodeLenses,
    linkedEditing,
    semanticEnabled,
    toggleSemantic: () => setSemanticEnabled((value) => !value),
    fail,
  }
}
export type LspFeatures = ReturnType<typeof useLspFeatures>
