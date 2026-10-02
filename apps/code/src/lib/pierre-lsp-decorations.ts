import type {
  DocumentHighlight,
  FoldingRange,
  InlayHint,
  SemanticTokens,
  SemanticTokensLegend,
  DocumentLink,
} from 'vscode-languageserver-protocol'

export const lspDecorationCSS = `
  [data-lsp-highlight] { background: light-dark(#add6ff66, #264f7866); outline: 1px solid light-dark(#007acc44, #99999944); }
  [data-lsp-highlight="3"] { outline-style: solid; outline-color: light-dark(#007acc88, #cccccc88); }
  [data-lsp-semantic="class"], [data-lsp-semantic="type"], [data-lsp-semantic="struct"],
  [data-lsp-semantic="enum"], [data-lsp-semantic="typeParameter"] { color: light-dark(#267f99, #4ec9b0) !important; }
  [data-lsp-semantic="function"], [data-lsp-semantic="method"] { color: light-dark(#795e26, #dcdcaa) !important; }
  [data-lsp-semantic="parameter"], [data-lsp-semantic="variable"], [data-lsp-semantic="property"] { color: light-dark(#001080, #9cdcfe) !important; }
  [data-lsp-semantic="enumMember"], [data-lsp-readonly] { color: light-dark(#0070c1, #4fc1ff) !important; }
  [data-lsp-semantic="macro"] { color: light-dark(#795e26, #c586c0) !important; }
  [data-lsp-deprecated] { text-decoration: line-through; opacity: .7; }
  [data-lsp-fold-hidden] { display: none !important; }
  [data-lsp-fold-header]::after { content: " …"; color: light-dark(#666, #aaa); background: light-dark(#ddd, #333); border-radius: 2px; }
  :host([data-definition-modifier]) [data-lsp-link]:hover { cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
`

type Decorations = {
  hints: InlayHint[]
  tokens: SemanticTokens | null
  folds: FoldingRange[]
  links: DocumentLink[]
  highlights: DocumentHighlight[]
}
const attributes = [
  'data-lsp-semantic',
  'data-lsp-readonly',
  'data-lsp-deprecated',
  'data-lsp-inlay-before',
  'data-lsp-inlay-after',
  'data-lsp-highlight',
  'data-lsp-fold-hidden',
  'data-lsp-fold-header',
  'data-lsp-link',
]
function inRange(
  line: number,
  char: number,
  range: DocumentHighlight['range'],
) {
  return (
    (line > range.start.line ||
      (line === range.start.line && char >= range.start.character)) &&
    (line < range.end.line ||
      (line === range.end.line && char < range.end.character))
  )
}

/** Decorations stay on Pierre's existing elements and never replace editable text. */
export function decoratePierre(
  host: HTMLElement,
  data: Decorations,
  legend: SemanticTokensLegend | undefined,
  folded: Set<number>,
) {
  const root = host.shadowRoot
  if (!root) return
  for (const attribute of attributes)
    for (const node of root.querySelectorAll(`[${attribute}]`))
      node.removeAttribute(attribute)
  const tokens = [
    ...root.querySelectorAll<HTMLElement>(
      '[data-content] [data-char], [data-code] [data-char]',
    ),
  ].map((node) => ({
    node,
    line:
      Number.parseInt(
        node.closest('[data-line]')?.getAttribute('data-line') ?? '',
        10,
      ) - 1,
    character: Number.parseInt(node.getAttribute('data-char') ?? '', 10),
  }))
  const byLine = new Map<number, typeof tokens>()
  for (const token of tokens)
    byLine.set(token.line, [...(byLine.get(token.line) ?? []), token])
  if (data.tokens && legend) {
    let line = 0,
      character = 0
    for (let i = 0; i + 4 < data.tokens.data.length; i += 5) {
      const [deltaLine, deltaCharacter, length, typeIndex, modifiers] =
        data.tokens.data.slice(i, i + 5)
      line += deltaLine
      character = deltaLine ? deltaCharacter : character + deltaCharacter
      const type = legend.tokenTypes[typeIndex]
      for (const token of byLine.get(line) ?? []) {
        if (
          token.character < character ||
          token.character >= character + length
        )
          continue
        if (type) token.node.setAttribute('data-lsp-semantic', type)
        legend.tokenModifiers.forEach((modifier, index) => {
          if (
            modifiers & (1 << index) &&
            ['readonly', 'deprecated'].includes(modifier)
          )
            token.node.setAttribute(`data-lsp-${modifier}`, '')
        })
      }
    }
  }
  for (const token of tokens) {
    const highlight = data.highlights.find((highlight) =>
      inRange(token.line, token.character, highlight.range),
    )
    if (highlight)
      token.node.setAttribute('data-lsp-highlight', String(highlight.kind ?? 1))
    const link = data.links.find((link) =>
      inRange(token.line, token.character, link.range),
    )
    if (link) token.node.setAttribute('data-lsp-link', '')
  }
  const hidden = new Set<number>()
  for (const range of data.folds) {
    if (!folded.has(range.startLine)) continue
    for (let line = range.startLine + 1; line <= range.endLine; line++)
      hidden.add(line)
    root
      .querySelector(
        `[data-content] [data-line="${range.startLine + 1}"], [data-code] [data-line="${range.startLine + 1}"]`,
      )
      ?.setAttribute('data-lsp-fold-header', '')
  }
  for (const row of root.querySelectorAll(
    '[data-line], [data-column-number]',
  )) {
    const line =
      Number.parseInt(
        row.getAttribute('data-line') ??
          row.getAttribute('data-column-number') ??
          '',
        10,
      ) - 1
    if (hidden.has(line)) row.setAttribute('data-lsp-fold-hidden', '')
  }
}
