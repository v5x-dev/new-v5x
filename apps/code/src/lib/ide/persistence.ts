import type { ProjectTemplate } from './compile-commands'
import type { Documents } from './workspace'

const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('v5x-code-workspaces', 1)
    request.onupgradeneeded = () =>
      request.result.createObjectStore('workspaces')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
export interface SavedWorkspace {
  template?: ProjectTemplate
  documents: Documents
  commitSha: string
  tabs: Array<string>
  selectedFile: string
}
export async function readWorkspace(
  key: string,
): Promise<SavedWorkspace | undefined> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction('workspaces')
        .objectStore('workspaces')
        .get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
export async function writeWorkspace(key: string, value: SavedWorkspace) {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('workspaces', 'readwrite')
      transaction.objectStore('workspaces').put(value, key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export async function listWorkspaces(): Promise<
  Array<{ id: string; workspace: SavedWorkspace }>
> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const entries: Array<{ id: string; workspace: SavedWorkspace }> = []
      const request = db
        .transaction('workspaces')
        .objectStore('workspaces')
        .openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor && entries.length < 100) {
          entries.push({
            id: String(cursor.key),
            workspace: cursor.value as SavedWorkspace,
          })
          cursor.continue()
        } else resolve(entries)
      }
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
