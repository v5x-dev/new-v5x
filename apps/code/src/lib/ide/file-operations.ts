import { validPath, workspaceDocuments } from './workspace'
import type { Documents } from './workspace'

export type FileOperation =
  | { kind: 'create'; path: string; folder?: boolean }
  | { kind: 'delete'; path: string }
  | { kind: 'move'; path: string; to: string }
  | { kind: 'copy'; path: string; to: string; files: Record<string, string> }

export interface FileOperations {
  read: (path: string) => Record<string, string>
  apply: (operation: FileOperation) => void
}
export const withinPath = (file: string, path: string) =>
  file === path || file.startsWith(`${path}/`)
export function readFiles(documents: Documents, path: string) {
  return Object.fromEntries(
    workspaceDocuments(documents)
      .filter((doc) => !doc.deleted && withinPath(doc.path, path))
      .map((doc) => [doc.path, doc.contents]),
  )
}

/** File operations are atomic and never overwrite an existing file or folder. */
export function applyFileOperation(
  documents: Documents,
  operation: FileOperation,
) {
  const next = { ...documents }
  const live = workspaceDocuments(documents).filter((doc) => !doc.deleted)
  const path = operation.path.replace(/\/$/, '')
  if (!validPath(path) || path.split('/').includes('.git'))
    throw new Error('Enter a relative project path without . or .. segments.')
  const destination = 'to' in operation ? operation.to.replace(/\/$/, '') : path
  if (!validPath(destination) || destination.split('/').includes('.git'))
    throw new Error('Enter a valid relative destination path.')
  const source = live.filter((doc) => withinPath(doc.path, path))
  if (
    (operation.kind === 'move' || operation.kind === 'delete') &&
    !source.length
  )
    throw new Error('The file or folder no longer exists.')
  if (operation.kind === 'move' && destination === path) return documents
  if (operation.kind === 'move' && withinPath(destination, path))
    throw new Error('A folder cannot be moved inside itself.')
  if (operation.kind !== 'delete') {
    if (
      live.some(
        (doc) =>
          withinPath(doc.path, destination) ||
          destination.startsWith(`${doc.path}/`),
      )
    )
      throw new Error(`A file or folder already exists at ${destination}.`)
    const files =
      operation.kind === 'create'
        ? { [operation.folder ? `${destination}/.gitkeep` : destination]: '' }
        : operation.kind === 'copy'
          ? Object.fromEntries(
              Object.entries(operation.files).map(([file, contents]) => {
                if (!withinPath(file, path))
                  throw new Error('Invalid clipboard file.')
                return [destination + file.slice(path.length), contents]
              }),
            )
          : Object.fromEntries(
              source.map((doc) => [
                destination + doc.path.slice(path.length),
                doc.contents,
              ]),
            )
    if (!Object.keys(files).length)
      throw new Error('There are no files to paste.')
    for (const [file, contents] of Object.entries(files)) {
      if (!validPath(file)) throw new Error('Invalid file path.')
      next[file] = {
        path: file,
        contents,
        baseline: next[file]?.baseline ?? null,
        version: (next[file]?.version ?? 0) + 1,
      }
    }
  }
  if (operation.kind === 'delete' || operation.kind === 'move') {
    for (const doc of source) {
      if (doc.baseline === null) delete next[doc.path]
      else next[doc.path] = { ...doc, deleted: true, version: doc.version + 1 }
    }
  }
  return next
}
