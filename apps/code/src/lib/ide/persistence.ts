import { workspaceIO } from './workspace-io'
import type { ProjectTemplate } from './compile-commands'
import type { Documents } from './workspace'

const revisions = new Map<string, string | undefined>()

const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('v5x-code-workspaces', 1)

    request.onupgradeneeded = () =>
      request.result.createObjectStore('workspaces')

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

export interface SavedWorkspace {
  storageRevision?: string
  conflicts?: Array<string>
  template?: ProjectTemplate
  documents: Documents
  commitSha: string
  tabs: Array<string>
  selectedFile: string
}

async function readWorkspaceNow(
  key: string,
): Promise<SavedWorkspace | undefined> {
  const db = await database()

  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction('workspaces')
        .objectStore('workspaces')
        .get(key)

      request.onsuccess = () => {
        const value = request.result as SavedWorkspace | undefined
        revisions.set(key, value?.storageRevision)
        resolve(value)
      }
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

async function writeWorkspaceNow(key: string, value: SavedWorkspace) {
  const db = await database()

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('workspaces', 'readwrite')
      const store = transaction.objectStore('workspaces')
      const read = store.get(key)
      const nextRevision = crypto.randomUUID()
      let conflict: Error | undefined
      read.onsuccess = () => {
        const current = read.result as SavedWorkspace | undefined
        if (
          !revisions.has(key) ||
          current?.storageRevision !== revisions.get(key)
        ) {
          conflict = new Error(
            'Another tab saved this project. Download a recovery copy of your edits before reloading.',
          )
          transaction.abort()
          return
        }
        store.put({ ...value, storageRevision: nextRevision }, key)
      }
      transaction.oncomplete = () => {
        revisions.set(key, nextRevision)
        resolve()
      }
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(conflict ?? transaction.error)
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

export function readWorkspace(
  key: string,
): Promise<SavedWorkspace | undefined> {
  return workspaceIO(key, () => readWorkspaceNow(key))
}

export function writeWorkspace(
  key: string,
  value: SavedWorkspace,
): Promise<void> {
  return workspaceIO(key, () => writeWorkspaceNow(key, value))
}

export function deleteWorkspace(key: string): Promise<void> {
  return workspaceIO(key, async () => {
    const db = await database()

    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('workspaces', 'readwrite')
        transaction.objectStore('workspaces').delete(key)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      // Make a delayed writer from an open editor tab conflict after deletion.
      revisions.set(key, crypto.randomUUID())
    } finally {
      db.close()
    }
  })
}
