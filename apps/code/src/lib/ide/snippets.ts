import { SnippetParser } from 'vscode-snippet-parser'
import type { Position } from 'vscode-languageserver-protocol'

export interface SnippetStop {
  index: number
  start: number
  end: number
}
export function expandSnippet(source: string, path: string, selectedText = '') {
  const snippet = new SnippetParser().parse(source, true)
  const filename = path.split('/').pop() ?? ''
  snippet.resolveVariables({
    resolve: (variable) =>
      ({
        TM_FILENAME: filename,
        TM_FILENAME_BASE: filename.replace(/\.[^.]+$/, ''),
        TM_DIRECTORY: path.slice(0, path.lastIndexOf('/')),
        TM_FILEPATH: path,
        TM_SELECTED_TEXT: selectedText,
        CURRENT_YEAR: String(new Date().getFullYear()),
      })[variable.name],
  })
  return {
    text: snippet.toString(),
    stops: snippet.placeholders
      .map((placeholder) => ({
        index: placeholder.index,
        start: snippet.offset(placeholder),
        end: snippet.offset(placeholder) + snippet.fullLen(placeholder),
      }))
      .sort(
        (a, b) =>
          (a.index || Number.MAX_SAFE_INTEGER) -
          (b.index || Number.MAX_SAFE_INTEGER),
      ),
  }
}
export function offsetPosition(text: string, offset: number): Position {
  const prefix = text.slice(0, offset)
  const line = (prefix.match(/\n/g) ?? []).length
  const last = prefix.lastIndexOf('\n')
  return { line, character: prefix.length - last - 1 }
}
export function remapSnippetStops(
  stops: Array<SnippetStop>,
  changes: Array<{ start: number; end: number; text: string }>,
) {
  const ordered = [...changes].sort((a, b) => a.start - b.start)
  const remap = (offset: number, end: boolean) => {
    let delta = 0
    for (const change of ordered) {
      if (offset < change.start) break
      if (offset <= change.end)
        return (
          change.start +
          delta +
          (end || (offset === change.end && change.end !== change.start)
            ? change.text.length
            : 0)
        )
      delta += change.text.length - (change.end - change.start)
    }
    return offset + delta
  }
  return stops.map((stop) => ({
    ...stop,
    start: remap(stop.start, false),
    end: remap(stop.end, true),
  }))
}
