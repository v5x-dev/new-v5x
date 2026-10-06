import type { TextEdit } from 'vscode-languageserver-protocol'
import type { ClangdClient } from './clangd-client'
import type { Documents } from './workspace'
import {
  applyTextEdits,
  fileUri,
  updateDocument,
  workspaceDocuments,
} from './workspace'

export async function formatWorkspace(
  documents: Documents,
  client: Pick<
    ClangdClient,
    'ready' | 'capabilities' | 'sync' | 'setFile' | 'request'
  > | null,
): Promise<Documents> {
  const live = workspaceDocuments(documents).filter((doc) => !doc.deleted)
  const sources = live.filter((doc) =>
    /\.(c|cc|cpp|cxx|h|hpp|hxx)$/.test(doc.path),
  )
  if (!sources.length) return documents

  if (!client?.ready)
    throw new Error('Wait for the language service before committing.')

  if (!client.capabilities.documentFormattingProvider)
    throw new Error('Formatting is unavailable for this language.')

  // Include current configuration files before requesting clangd formatting.
  for (const doc of live) client.setFile(doc.path, doc.contents, doc.version)

  for (const doc of sources) client.sync(doc.path, doc.contents, doc.version)

  let formatted = documents

  for (const doc of sources) {
    const edits = await client.request<Array<TextEdit> | null>(
      'textDocument/formatting',
      {
        textDocument: { uri: fileUri(doc.path) },
        options: { tabSize: 2, insertSpaces: true },
      },
    )

    if (edits?.length)
      formatted = updateDocument(
        formatted,
        doc.path,
        applyTextEdits(doc.contents, edits),
      )
  }

  return formatted
}
