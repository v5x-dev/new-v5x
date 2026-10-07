import type { BrowserBuildInput, BrowserBuildResult } from './browser-build'

let idleWorker: Worker | undefined
let idleTimer: ReturnType<typeof setTimeout> | undefined

export function releaseBrowserCompiler() {
  clearTimeout(idleTimer)
  idleWorker?.terminate()
  idleWorker = undefined
}

export function buildInBrowser(
  input: BrowserBuildInput,
  report: (text: string) => void,
  signal?: AbortSignal,
): Promise<BrowserBuildResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Build cancelled', 'AbortError'))
      return
    }
    clearTimeout(idleTimer)
    const worker =
      idleWorker ??
      new Worker(new URL('./build.worker.ts', import.meta.url), {
        type: 'module',
      })
    idleWorker = undefined
    const stop = (reuse = false) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      worker.onmessage = null
      worker.onerror = null
      if (reuse && !idleWorker) {
        idleWorker = worker
        idleTimer = setTimeout(releaseBrowserCompiler, 60_000)
      } else worker.terminate()
    }
    const abort = () => {
      stop()
      reject(new DOMException('Build cancelled', 'AbortError'))
    }
    const timer = setTimeout(() => {
      stop()
      reject(new Error('Browser build exceeded 5 minutes'))
    }, 300_000)
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = (event) => {
      stop()
      reject(new Error(event.message || 'Browser compiler worker crashed'))
    }
    worker.onmessage = ({ data }) => {
      if (data.kind === 'output') report(data.text)
      else if (data.kind === 'result') {
        stop(true)
        resolve(data.result)
      } else if (data.kind === 'error') {
        stop()
        reject(new Error(data.message))
      }
    }
    worker.postMessage(input)
  })
}

const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('v5x-browser-builds', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('builds')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

export async function readBrowserBuild(
  workspaceId: string,
): Promise<BrowserBuildResult | undefined> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction('builds')
        .objectStore('builds')
        .get(workspaceId)
      request.onsuccess = () => {
        const result = request.result as BrowserBuildResult | undefined
        // Older browser builds stored a monolith. Rebuild it as hot/cold packages.
        resolve(
          result?.artifacts.some(
            (artifact) => artifact.path === 'bin/monolith.bin',
          )
            ? undefined
            : result,
        )
      }
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function writeBrowserBuild(
  workspaceId: string,
  result: BrowserBuildResult,
) {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('builds', 'readwrite')
      transaction.objectStore('builds').put(result, workspaceId)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}
