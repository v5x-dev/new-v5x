import type { TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import type { WorkspaceFile } from './browser-lsp-types'
import { safeWorkspacePath } from './browser-lsp-types'

export function textOffset(
  text: string,
  position: { line: number; character: number },
) {
  const lines = text.split('\n')
  if (
    position.line < 0 ||
    position.line >= lines.length ||
    position.character < 0 ||
    position.character > lines[position.line].replace(/\r$/, '').length
  )
    throw new Error('The language server returned an invalid edit position')
  return (
    lines
      .slice(0, position.line)
      .reduce((offset, line) => offset + line.length + 1, 0) +
    position.character
  )
}

export function textPosition(text: string, offset: number) {
  const lines = text.slice(0, offset).split('\n')
  return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 }
}

export function editText(text: string, edits: TextEdit[]) {
  const resolved = edits
    .map((edit) => ({
      start: textOffset(text, edit.range.start),
      end: textOffset(text, edit.range.end),
      newText: edit.newText,
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end)
  let end = 0
  for (const edit of resolved) {
    if (edit.start < end || edit.end < edit.start)
      throw new Error('The language server returned overlapping edits')
    end = edit.end
  }
  let result = text
  for (const edit of resolved.reverse())
    result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end)
  return result
}

export function workspacePath(uri: string) {
  const url = new URL(uri)
  const path = decodeURIComponent(url.pathname).replace(/^\/workspace\//, '')
  if (
    url.protocol !== 'file:' ||
    url.host ||
    !url.pathname.startsWith('/workspace/') ||
    !safeWorkspacePath(path)
  )
    throw new Error('SDK files are read only')
  return path
}

type Document = { contents: string; savedContents: string; version: number }
type LiveEditor = { getText(): string; applyEdits(edits: TextEdit[]): void }

/** Owns project drafts independently of which Pierre file is currently attached. */
export class LspWorkspace {
  private files = new Map<string, Document>()
  private editors = new Map<string, LiveEditor>()
  private listeners = new Set<(path: string) => void>()

  seed(files: WorkspaceFile[]) {
    for (const file of files)
      if (!this.files.has(file.path))
        this.files.set(file.path, {
          contents: file.contents,
          savedContents: file.contents,
          version: 1,
        })
  }
  get(path: string) {
    return this.files.get(path)
  }
  all() {
    return [...this.files].map(([path, file]) => ({ path, ...file }))
  }
  dirty() {
    return this.all().filter((file) => file.contents !== file.savedContents)
  }
  onChange(listener: (path: string) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private emit(path: string) {
    for (const listener of this.listeners) listener(path)
  }
  change(path: string, contents: string) {
    const file = this.files.get(path)
    if (!file) throw new Error(`File has not loaded: ${path}`)
    if (file.contents === contents) return
    file.contents = contents
    file.version++
    this.emit(path)
  }
  markSaved(path: string, contents: string) {
    const file = this.files.get(path)
    if (!file) return
    file.savedContents = contents
    this.emit(path)
  }
  attach(path: string, editor: LiveEditor) {
    this.editors.set(path, editor)
    return () => {
      if (this.editors.get(path) === editor) this.editors.delete(path)
    }
  }
  preview(edit: WorkspaceEdit) {
    const changes = new Map<string, TextEdit[]>()
    for (const [uri, edits] of Object.entries(edit.changes ?? {}))
      changes.set(workspacePath(uri), edits)
    for (const change of edit.documentChanges ?? []) {
      if ('kind' in change)
        throw new Error(
          'Creating, deleting, and moving files is not supported by this project storage',
        )
      const path = workspacePath(change.textDocument.uri)
      const file = this.files.get(path)
      if (
        change.textDocument.version !== null &&
        change.textDocument.version !== file?.version
      )
        throw new Error(
          'The document changed while this edit was being prepared. Try again.',
        )
      if (change.edits.some((edit) => !('newText' in edit)))
        throw new Error('Workspace snippet edits are not supported')
      changes.set(path, [
        ...(changes.get(path) ?? []),
        ...(change.edits as TextEdit[]),
      ])
    }
    return [...changes].map(([path, edits]) => {
      const file = this.files.get(path)
      if (!file) throw new Error(`File has not loaded: ${path}`)
      return {
        path,
        edits,
        before: file.contents,
        after: editText(file.contents, edits),
        version: file.version,
      }
    })
  }
  apply(edit: WorkspaceEdit) {
    const changes = this.preview(edit)
    // Validate the entire edit before touching any document. All edits remain drafts.
    for (const change of changes) {
      const editor = this.editors.get(change.path)
      if (editor && editor.getText() !== change.before)
        throw new Error(
          'The editor changed while this edit was being prepared. Try again.',
        )
    }
    for (const change of changes) {
      this.editors.get(change.path)?.applyEdits(change.edits)
      this.change(change.path, change.after)
    }
    return changes
  }
}
