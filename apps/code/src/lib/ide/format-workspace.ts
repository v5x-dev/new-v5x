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

  if (!client?.ready || !client.capabilities.documentFormattingProvider)
    return documents

  // Formatting must not prevent committing on machines where clangd is slow.
  // Bound the whole pass, and discard partial formatting if any file fails.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3_000)

  try {
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
        controller.signal,
        3_000,
      )

      if (edits?.length)
        formatted = updateDocument(
          formatted,
          doc.path,
          applyTextEdits(doc.contents, edits),
        )
    }

    return formatted
  } catch {
    return documents
  } finally {
    clearTimeout(timer)
  }
}
