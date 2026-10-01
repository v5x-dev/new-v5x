export type BrowserFileSystem = {
  mkdirTree(path: string): void
  writeFile(path: string, contents: string | Uint8Array): void
  readFile(path: string): Uint8Array
  readdir(path: string): string[]
  stat(path: string): { mode: number }
  isDir(mode: number): boolean
}

type IndexFile = { path: string; contents: Uint8Array }
type SavedIndex = { key: string; updatedAt: number; files: IndexFile[] }
const root = '/workspace/.cache/clangd/index'

// Persist only clangd's derived index, never editor drafts. IndexedDB is optional.
export class BrowserLspIndex {
  private database: IDBDatabase | undefined
  private saving = false
  constructor(
    private readonly key: string,
    private readonly fs: BrowserFileSystem,
  ) {}

  async restore() {
    try {
      this.database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('v5x-clangd-index', 1)
        request.onupgradeneeded = () =>
          request.result.createObjectStore('projects', { keyPath: 'key' })
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        request.onblocked = () => reject(new Error('Index cache is blocked'))
      })
      const saved = await new Promise<SavedIndex | undefined>(
        (resolve, reject) => {
          const request = this.database!.transaction('projects')
            .objectStore('projects')
            .get(this.key)
          request.onsuccess = () =>
            resolve(request.result as SavedIndex | undefined)
          request.onerror = () => reject(request.error)
        },
      )
      for (const file of saved?.files ?? []) {
        if (
          !file.path.startsWith(`${root}/`) ||
          file.path.includes('..') ||
          !(file.contents instanceof Uint8Array)
        )
          continue
        this.fs.mkdirTree(file.path.slice(0, file.path.lastIndexOf('/')))
        this.fs.writeFile(file.path, file.contents)
      }
    } catch {
      /* Unavailable/quota-limited storage does not prevent editing. */
    }
  }

  async persist() {
    if (!this.database || this.saving) return
    this.saving = true
    try {
      const files: IndexFile[] = []
      const visit = (path: string) => {
        for (const name of this.fs.readdir(path)) {
          if (name === '.' || name === '..') continue
          const child = `${path}/${name}`
          if (this.fs.isDir(this.fs.stat(child).mode)) visit(child)
          else files.push({ path: child, contents: this.fs.readFile(child) })
        }
      }
      try {
        visit(root)
      } catch {
        return
      }
      // Bound disk/memory usage on devices with many projects.
      if (
        !files.length ||
        files.reduce((size, file) => size + file.contents.length, 0) >
          32 * 1024 * 1024
      )
        return
      await new Promise<void>((resolve, reject) => {
        const transaction = this.database!.transaction('projects', 'readwrite')
        const store = transaction.objectStore('projects')
        store.put({
          key: this.key,
          updatedAt: Date.now(),
          files,
        } satisfies SavedIndex)
        const request = store.getAll()
        request.onsuccess = () => {
          const rows = request.result as SavedIndex[]
          rows.sort((a, b) => b.updatedAt - a.updatedAt)
          for (const old of rows.slice(8)) store.delete(old.key)
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } catch {
      /* Cache writes are best effort. */
    } finally {
      this.saving = false
    }
  }
}
