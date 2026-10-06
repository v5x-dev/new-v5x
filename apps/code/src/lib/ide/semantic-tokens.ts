import type {
  Range,
  SemanticTokens,
  SemanticTokensLegend,
} from 'vscode-languageserver-protocol'

export interface SemanticColor {
  range: Range
  color: string
}

const colors: Record<string, string> = {
  namespace: '#EFAC32',
  type: '#EFAC32',
  class: '#EFAC32',
  enum: '#EFAC32',
  interface: '#EFAC32',
  struct: '#EFAC32',
  typeParameter: '#D9D762',
  parameter: '#E6E1C4',
  variable: '#E6E1C4',
  property: '#6C99BB',
  enumMember: '#BBDFAA',
  function: '#BBDFAA',
  method: '#BBDFAA',
  macro: '#EF5D32',
  keyword: '#EF5D32',
  string: '#D9D762',
  number: '#BBDFAA',
  comment: '#6B4E32',
}

export function decodeSemanticTokens(
  result: SemanticTokens,
  legend: SemanticTokensLegend,
): Array<SemanticColor> {
  if (result.data.length % 5) throw new Error('Invalid semantic token data')

  let line = 0,
    character = 0

  const tokens: Array<SemanticColor> = []

  for (let index = 0; index < result.data.length; index += 5) {
    const [deltaLine, deltaChar, length, type] = result.data.slice(
      index,
      index + 5,
    )

    if (
      [deltaLine, deltaChar, length, type].some(
        (value) => !Number.isInteger(value) || value < 0,
      )
    )
      throw new Error('Invalid semantic token position')

    line += deltaLine
    character = deltaLine ? deltaChar : character + deltaChar
    const name = legend.tokenTypes[type]

    if (colors[name] && length)
      tokens.push({
        range: {
          start: { line, character },
          end: { line, character: character + length },
        },
        color: colors[name],
      })
  }

  return tokens
}
