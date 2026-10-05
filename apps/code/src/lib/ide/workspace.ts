import type {
  Position,
  TextEdit,
  WorkspaceEdit,
} from 'vscode-languageserver-protocol'

export interface WorkspaceDocument {
  path: string
  contents: string
  baseline: string | null
  version: number
  deleted?: boolean
}
export type Documents = Partial<Record<string, WorkspaceDocument>>
export function workspaceDocuments(
  documents: Documents,
): Array<WorkspaceDocument> {
  return Object.values(documents).filter(
    (doc): doc is WorkspaceDocument => doc !== undefined,
  )
}
export const workspaceRoot = '/workspace'

export function validPath(path: string) {
  return (
    !!path &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !path.split('/').some((part) => !part || part === '.' || part === '..')
  )
}
export function fileUri(path: string) {
  if (!validPath(path)) throw new Error('Invalid workspace path')
  return `file://${workspaceRoot}/${path.split('/').map(encodeURIComponent).join('/')}`
}
export function uriPath(uri: string) {
  const url = new URL(uri)
  const prefix = `${workspaceRoot}/`
  if (url.protocol !== 'file:' || url.host || !url.pathname.startsWith(prefix))
    throw new Error('Edit targets a file outside this workspace')
  const path = decodeURIComponent(url.pathname.slice(prefix.length))
  if (!validPath(path)) throw new Error('Invalid workspace path')
  return path
}
export function positionOffset(text: string, position: Position) {
  if (
    !Number.isInteger(position.line) ||
    !Number.isInteger(position.character) ||
    position.line < 0 ||
    position.character < 0
  )
    throw new Error('Invalid text position')
  let offset = 0
  for (let line = 0; line < position.line; line++) {
    const next = text.indexOf('\n', offset)
    if (next < 0) throw new Error('Text position is outside the document')
    offset = next + 1
  }
  const end = text.indexOf('\n', offset)
  let length = (end < 0 ? text.length : end) - offset
  if (text[offset + length - 1] === '\r') length--
  if (position.character > length)
    throw new Error('Text position is outside the line')
  return offset + position.character
}
export function applyTextEdits(text: string, edits: Array<TextEdit>) {
  const resolved = edits
    .map((edit, index) => ({
      start: positionOffset(text, edit.range.start),
      end: positionOffset(text, edit.range.end),
      text: edit.newText,
      index,
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index)
  for (let i = 0; i < resolved.length; i++) {
    if (
      resolved[i].end < resolved[i].start ||
      (i > 0 && resolved[i].start < resolved[i - 1].end)
    )
      throw new Error('Overlapping or reversed text edits')
  }
  for (const edit of resolved.reverse())
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
  return text
}
export function isDirty(doc: WorkspaceDocument) {
  return doc.deleted ? doc.baseline !== null : doc.contents !== doc.baseline
}
export function updateDocument(
  documents: Documents,
  path: string,
  contents: string,
): Documents {
  const old = documents[path]
  if (!old || old.deleted) throw new Error('Document is not loaded')
  if (old.contents === contents) return documents
  return {
    ...documents,
    [path]: { ...old, contents, version: old.version + 1 },
  }
}
/** Validate every operation before publishing any of the resulting documents. */
export function applyWorkspaceEdit(
  documents: Documents,
  edit: WorkspaceEdit,
): Documents {
  let result = { ...documents }
  const change = (
    uri: string,
    edits: Array<TextEdit>,
    version?: number | null,
  ) => {
    const path = uriPath(uri)
    const doc = result[path]
    if (!doc || doc.deleted) throw new Error(`Document not loaded: ${path}`)
    if (version != null && doc.version !== version)
      throw new Error(`Document changed while refactoring: ${path}`)
    result = updateDocument(result, path, applyTextEdits(doc.contents, edits))
  }
  if (edit.changes && edit.documentChanges)
    throw new Error('Ambiguous workspace edit')
  for (const [uri, edits] of Object.entries(edit.changes ?? {}))
    change(uri, edits)
  for (const operation of edit.documentChanges ?? []) {
    if ('textDocument' in operation) {
      if (operation.edits.some((entry) => 'annotationId' in entry))
        throw new Error('Annotated edits require confirmation')
      change(
        operation.textDocument.uri,
        operation.edits,
        operation.textDocument.version,
      )
    } else if (operation.kind === 'create') {
      const path = uriPath(operation.uri)
      if (result[path] && !result[path].deleted) {
        if (operation.options?.ignoreIfExists) continue
        if (!operation.options?.overwrite)
          throw new Error(`File already exists: ${path}`)
      }
      result[path] = {
        path,
        contents: '',
        baseline: result[path]?.baseline ?? null,
        version: (result[path]?.version ?? 0) + 1,
      }
    } else if (operation.kind === 'rename') {
      const oldPath = uriPath(operation.oldUri),
        newPath = uriPath(operation.newUri)
      const doc = result[oldPath]
      if (!doc || doc.deleted) throw new Error(`File not loaded: ${oldPath}`)
      if (result[newPath] && !result[newPath].deleted) {
        if (operation.options?.ignoreIfExists) continue
        if (!operation.options?.overwrite)
          throw new Error(`File already exists: ${newPath}`)
      }
      result[newPath] = {
        ...doc,
        path: newPath,
        baseline: result[newPath]?.baseline ?? null,
        version: (result[newPath]?.version ?? 0) + 1,
      }
      result[oldPath] = { ...doc, deleted: true, version: doc.version + 1 }
    } else {
      const path = uriPath(operation.uri)
      if (!result[path]) {
        if (operation.options?.ignoreIfNotExists) continue
        throw new Error(`File not loaded: ${path}`)
      }
      result[path] = {
        ...result[path],
        deleted: true,
        version: result[path].version + 1,
      }
    }
  }
  return result
}
export function searchWorkspace(
  documents: Documents,
  query: string,
  matchCase = false,
) {
  const results: Array<{
    path: string
    line: number
    character: number
    text: string
  }> = []
  if (!query) return results
  const needle = matchCase ? query : query.toLowerCase()
  for (const doc of workspaceDocuments(documents)) {
    if (doc.deleted) continue
    doc.contents.split(/\r?\n/).forEach((text, line) => {
      const source = matchCase ? text : text.toLowerCase()
      let character = source.indexOf(needle)
      while (character >= 0 && results.length < 2000) {
        results.push({ path: doc.path, line, character, text })
        character = source.indexOf(
          needle,
          character + Math.max(1, needle.length),
        )
      }
    })
  }
  return results
}

/** Rebase drafts only when the incoming file still matches their baseline. */
export function recoverDocuments(
  files: Record<string, string>,
  cached?: { documents: Documents; conflicts?: Array<string> },
) {
  const documents: Documents = Object.fromEntries(
    Object.entries(files).map(([path, contents]) => [
      path,
      { path, contents, baseline: contents, version: 1 },
    ]),
  )
  const conflicts = new Set<string>()
  for (const draft of workspaceDocuments(cached?.documents ?? {})) {
    if (!isDirty(draft) && !cached?.conflicts?.includes(draft.path)) continue
    const incoming = files[draft.path] ?? null
    documents[draft.path] = {
      ...draft,
      baseline: incoming,
      version: draft.version + 1,
    }
    if (
      cached?.conflicts?.includes(draft.path) ||
      (incoming !== draft.baseline &&
        incoming !== (draft.deleted ? null : draft.contents))
    )
      conflicts.add(draft.path)
  }
  return { documents, conflicts: [...conflicts] }
}
