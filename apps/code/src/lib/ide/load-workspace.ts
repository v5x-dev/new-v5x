import { readWorkspace, type SavedWorkspace } from './persistence'
import {
  recoverDocuments,
  type Documents,
  type ProjectSnapshot,
} from './workspace'

// Combines the remote commit with any local draft. A draft alone is used when
// the remote snapshot cannot be loaded.
export async function loadWorkspace(
  workspaceId: string,
  loadSnapshot: () => Promise<ProjectSnapshot>,
  onUnreadableDraft: () => void,
) {
  const cached = await readWorkspace(workspaceId).catch(() => {
    // Continue with the remote source, but preserve any unreadable local draft.
    onUnreadableDraft()
    return undefined
  })

  const loaded = await loadSnapshot()
    .then((remote) => ({
      commitSha: remote.commitSha,
      recovered: recoverDocuments(remote.files, cached),
    }))
    .catch((reason) => {
      if (!cached) throw reason

      return {
        commitSha: cached.commitSha,
        recovered: {
          documents: cached.documents,
          conflicts: cached.conflicts ?? [],
        },
      }
    })

  return { ...loaded, cached }
}

// Reopens the draft's tabs that still exist, plus the selected file. The
// draft's selection wins over the requested one when it still exists.
export function restoredTabs(
  cached: SavedWorkspace | undefined,
  documents: Documents,
  requestedFile: string,
) {
  const live = (path: string | undefined) =>
    !!path && !!documents[path] && !documents[path]?.deleted

  const tabs = (cached?.tabs ?? []).filter(live)
  const selectedFile = live(cached?.selectedFile)
    ? cached!.selectedFile
    : requestedFile

  return {
    tabs: [...new Set([...tabs, ...(selectedFile ? [selectedFile] : [])])],
    selectedFile,
  }
}
