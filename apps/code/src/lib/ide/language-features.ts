import type {
  CompletionItem,
  CompletionList,
  DocumentSymbol,
  FoldingRange,
  Location,
  LocationLink,
  Position,
  SemanticTokens,
  SymbolInformation,
  TextEdit,
} from 'vscode-languageserver-protocol'
import type { ClangdClient } from './clangd-client'
import { symbolFoldingRanges } from './folding'
import { decodeSemanticTokens, type SemanticColor } from './semantic-tokens'
import { expandSnippet, type SnippetStop } from './snippets'
import {
  applyTextEdits,
  fileUri,
  positionOffset,
  uriPath,
  type WorkspaceDocument,
} from './workspace'

const MAX_COMPLETIONS = 20
const ANALYSIS_TIMEOUT = 120_000

export const sourcePattern = /\.(c|cc|cpp|cxx)$/
export const headerPattern = /\.(h|hpp|hxx)$/
export const languagePattern = /\.(c|cc|cpp|cxx|h|hpp|hxx)$/

// Identifiers of two or more characters and member or scope access trigger
// completion while typing.
export const completionTrigger = /(?:[A-Za-z_]\w{1,}|\.|->|::)$/

export function shouldTriggerCompletion(text: string, offset: number) {
  return completionTrigger.test(text.slice(Math.max(0, offset - 128), offset))
}

// Keep the first entries in server order and drop documentation, which the
// popup does not show, to keep the list cheap to render.
export function normalizeCompletions(
  result: CompletionList | Array<CompletionItem> | null,
) {
  return (Array.isArray(result) ? result : (result?.items ?? []))
    .sort((a, b) =>
      (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label),
    )
    .slice(0, MAX_COMPLETIONS)
    .map((item) => {
      if (!item.documentation) return item
      const next = { ...item }
      delete next.documentation
      return next
    })
}

// Converts an accepted completion into editor edits. Snippet stops are
// returned as offsets into the edited text.
export function completionEdits(
  item: CompletionItem,
  doc: Pick<WorkspaceDocument, 'path' | 'contents'>,
  position: Position,
): { edits: Array<TextEdit>; stops: Array<SnippetStop> } {
  const edit = item.textEdit

  const primary: TextEdit = edit
    ? 'range' in edit
      ? { ...edit }
      : { range: edit.replace, newText: edit.newText }
    : {
        range: { start: position, end: position },
        newText: item.insertText ?? item.label,
      }

  const expanded =
    item.insertTextFormat === 2
      ? expandSnippet(primary.newText, doc.path)
      : null

  if (expanded) primary.newText = expanded.text
  const additional = item.additionalTextEdits ?? []
  const edits = [primary, ...additional]

  // Validates the edit ranges before Pierre applies them.
  applyTextEdits(doc.contents, edits)

  let start = positionOffset(doc.contents, primary.range.start)

  for (const entry of additional) {
    const end = positionOffset(doc.contents, entry.range.end)
    if (end <= start)
      start +=
        entry.newText.length -
        (end - positionOffset(doc.contents, entry.range.start))
  }

  return {
    edits,
    stops: (expanded?.stops ?? []).map((stop) => ({
      ...stop,
      start: stop.start + start,
      end: stop.end + start,
    })),
  }
}

export type DefinitionTarget =
  | { kind: 'workspace'; path: string; position: Position }
  | { kind: 'sdk'; path: string; position: Position }

export function definitionTarget(
  result: Location | Array<Location> | Array<LocationLink> | null,
): DefinitionTarget | null {
  if (!result) return null
  const first = Array.isArray(result) ? result.at(0) : result
  if (!first) return null

  const uri = 'targetUri' in first ? first.targetUri : first.uri
  const position =
    'targetUri' in first ? first.targetSelectionRange.start : first.range.start
  const pathname = new URL(uri).pathname

  if (pathname.startsWith('/workspace/'))
    return { kind: 'workspace', path: uriPath(uri), position }

  const path = decodeURIComponent(pathname)
  if (path.startsWith('/sdk/') || path.startsWith('/toolchain/'))
    return { kind: 'sdk', path, position }

  return null
}

export function requestDefinition(
  client: ClangdClient,
  path: string,
  position: Position,
) {
  return client
    .request<Location | Array<Location> | Array<LocationLink> | null>(
      'textDocument/definition',
      { textDocument: { uri: fileUri(path) }, position },
    )
    .then(definitionTarget)
}

export function requestSemanticColors(
  client: ClangdClient,
  path: string,
  signal: AbortSignal,
): Promise<Array<SemanticColor>> {
  const provider = client.capabilities.semanticTokensProvider
  if (!provider?.full) return Promise.resolve([])

  return client
    .request<SemanticTokens | null>(
      'textDocument/semanticTokens/full',
      { textDocument: { uri: fileUri(path) } },
      signal,
      ANALYSIS_TIMEOUT,
    )
    .then((result) =>
      result ? decodeSemanticTokens(result, provider.legend) : [],
    )
}

// Prefers folding ranges and falls back to document symbols.
export function requestFoldingRanges(
  client: ClangdClient,
  path: string,
  signal: AbortSignal,
): Promise<Array<FoldingRange>> {
  const params = { textDocument: { uri: fileUri(path) } }

  if (client.capabilities.foldingRangeProvider)
    return client
      .request<Array<FoldingRange> | null>(
        'textDocument/foldingRange',
        params,
        signal,
        ANALYSIS_TIMEOUT,
      )
      .then((result) => result ?? [])

  if (client.capabilities.documentSymbolProvider)
    return client
      .request<Array<DocumentSymbol> | Array<SymbolInformation> | null>(
        'textDocument/documentSymbol',
        params,
        signal,
        ANALYSIS_TIMEOUT,
      )
      .then((symbols) => symbolFoldingRanges(symbols ?? []))

  return Promise.resolve([])
}
