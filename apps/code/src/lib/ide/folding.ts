import type {
  DocumentSymbol,
  FoldingRange,
  SymbolInformation,
} from 'vscode-languageserver-protocol'

/** clangd 15 exposes structural ranges through document symbols, without foldingRange. */
export function symbolFoldingRanges(
  symbols: Array<DocumentSymbol> | Array<SymbolInformation>,
): Array<FoldingRange> {
  const ranges = new Map<number, FoldingRange>()
  const visit = (symbol: DocumentSymbol | SymbolInformation) => {
    const range = 'range' in symbol ? symbol.range : symbol.location.range
    if (range.end.line > range.start.line) {
      const existing = ranges.get(range.start.line)
      if (!existing || range.end.line > existing.endLine)
        ranges.set(range.start.line, {
          startLine: range.start.line,
          endLine: range.end.line,
        })
    }
    if ('children' in symbol) symbol.children?.forEach(visit)
  }
  symbols.forEach(visit)
  return [...ranges.values()].sort((a, b) => a.startLine - b.startLine)
}
