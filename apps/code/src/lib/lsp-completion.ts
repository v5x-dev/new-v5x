import { SnippetParser } from '@qualified/vscode-snippet-parser'
import type { Editor, EditorChange } from '@pierre/diffs/edit'
import type { LspCompletionItem } from './language-server-client'
import { textOffset, textPosition } from './lsp-workspace'

export const completionKinds = [
  '',
  'text',
  'method',
  'function',
  'constructor',
  'field',
  'variable',
  'class',
  'interface',
  'module',
  'property',
  'unit',
  'value',
  'enum',
  'keyword',
  'snippet',
  'color',
  'file',
  'reference',
  'folder',
  'enum member',
  'constant',
  'struct',
  'event',
  'operator',
  'type parameter',
]

export function completionPrefix(
  text: string,
  position: { line: number; character: number },
) {
  const line =
    text.split('\n')[position.line]?.slice(0, position.character) ?? ''
  return /[\w~]*$/.exec(line)?.[0] ?? ''
}

export function filterCompletions(items: LspCompletionItem[], prefix: string) {
  const needle = prefix.toLowerCase()
  const scored = items.flatMap((item, index) => {
    const label = (item.filterText ?? item.label).toLowerCase()
    let cursor = 0
    let score = label.startsWith(needle) ? 1000 : 0
    for (const character of needle) {
      const match = label.indexOf(character, cursor)
      if (match < 0) return []
      score += match === cursor ? 10 : -match
      cursor = match + 1
    }
    return [{ item, index, score }]
  })
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.item.sortText ?? a.item.label).localeCompare(
          b.item.sortText ?? b.item.label,
        ) ||
        a.index - b.index,
    )
    .map((value) => value.item)
}

type Stop = {
  index: number
  start: number
  end: number
  choices?: string[]
  transform?: { resolve(value: string): string }
}
export function parseSnippet(
  value: string,
  variables: Record<string, string> = {},
) {
  const snippet = new SnippetParser().parse(value, true)
  snippet.resolveVariables({ resolve: (variable) => variables[variable.name] })
  return {
    text: snippet.toString(),
    stops: snippet.placeholders.map((placeholder) => ({
      index: placeholder.index,
      start: snippet.offset(placeholder),
      end: snippet.offset(placeholder) + snippet.fullLen(placeholder),
      choices: placeholder.choice?.options.map((option) => option.value),
      transform: placeholder.transform,
    })),
  }
}

/** Tabstops use Pierre selections, including its native multiple cursor edits. */
export class SnippetSession {
  private stops: Stop[]
  private groups: number[]
  private group = 0
  private text: string
  constructor(
    private editor: Editor,
    stops: Stop[],
    base: number,
  ) {
    this.stops = stops.map((stop) => ({
      ...stop,
      start: stop.start + base,
      end: stop.end + base,
    }))
    this.groups = [...new Set(stops.map((stop) => stop.index))].sort((a, b) =>
      a === 0 ? 1 : b === 0 ? -1 : a - b,
    )
    this.text = editor.getText()
  }
  select() {
    const index = this.groups[this.group]
    const stops = this.stops.filter(
      (stop) => stop.index === index && !stop.transform,
    )
    if (!stops.length) return false
    this.editor.focus()
    this.editor.setSelections(
      stops.map((stop) => ({
        start: textPosition(this.editor.getText(), stop.start),
        end: textPosition(this.editor.getText(), stop.end),
        direction: 'forward',
      })),
    )
    return index !== 0
  }
  move(backwards = false) {
    const current = this.stops.find(
      (stop) => stop.index === this.groups[this.group] && !stop.transform,
    )
    const transforms = this.stops.filter(
      (stop) => stop.index === this.groups[this.group] && stop.transform,
    )
    if (current && transforms.length) {
      const text = this.editor.getText()
      const value = text.slice(current.start, current.end)
      this.editor.applyEdits(
        transforms.map((stop) => ({
          range: {
            start: textPosition(text, stop.start),
            end: textPosition(text, stop.end),
          },
          newText: stop.transform!.resolve(value),
        })),
      )
    }
    this.group = Math.max(0, this.group + (backwards ? -1 : 1))
    return this.select()
  }
  update(changes: EditorChange[], nextText: string) {
    const resolved = changes
      .map((change) => ({
        start: textOffset(this.text, change.range.start),
        end: textOffset(this.text, change.range.end),
        length: change.text.length,
      }))
      .sort((a, b) => b.start - a.start)
    for (const change of resolved) {
      const delta = change.length - (change.end - change.start)
      for (const stop of this.stops) {
        if (
          change.end <= stop.start &&
          !(change.start === stop.start && change.end === stop.start)
        ) {
          stop.start += delta
          stop.end += delta
        } else if (change.start <= stop.end && change.end >= stop.start) {
          stop.start = Math.min(stop.start, change.start)
          stop.end = Math.max(stop.start, stop.end + delta)
        }
      }
    }
    this.text = nextText
  }
  containsCursor() {
    const selection = this.editor.getViewState().selections?.[0]
    if (!selection) return false
    const offset = textOffset(this.editor.getText(), selection.end)
    return this.stops.some(
      (stop) =>
        stop.index === this.groups[this.group] &&
        offset >= stop.start &&
        offset <= stop.end,
    )
  }
}
