import { buildCacheKey } from './build-cache'
import { setBrowserBuildActive } from './build-activity'
import type { BuildTimingEvent } from './build-performance'
import type { BrowserBuildInput, BrowserBuildResult } from './browser-build'

const stableArtifacts = new Map<string, Uint8Array>()
let idleWorker: Worker | undefined
let activeWorker: Worker | undefined
let cancelActive: (() => void) | undefined
let sessionGeneration = 0
let buildQueue: Promise<unknown> = Promise.resolve()

export function releaseBrowserCompiler() {
  sessionGeneration++
  idleWorker?.terminate()
  idleWorker = undefined
  stableArtifacts.clear()
  cancelActive?.()
  activeWorker?.terminate()
  activeWorker = undefined
}

function executeBuild(
  input: BrowserBuildInput,
  report: (text: string) => void,
  signal?: AbortSignal,
  timing?: (event: BuildTimingEvent) => void,
): Promise<BrowserBuildResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Build cancelled', 'AbortError'))
      return
    }
    const started = performance.now()
    const lifecycle = (outcome: BuildTimingEvent['outcome']) =>
      timing?.({
        buildId: input.buildId!,
        clock: 'client',
        phase: 'request-to-artifacts',
        start: started,
        end: performance.now(),
        outcome,
      })
    const worker =
      idleWorker ??
      new Worker(new URL('./build.worker.ts', import.meta.url), {
        type: 'module',
      })
    idleWorker = undefined
    activeWorker = worker
    if (input.kind !== 'preload') setBrowserBuildActive(true)
    let chunks: Array<string> = []
    let bufferedBytes = 0
    const flush = () => {
      if (!chunks.length) return
      const text = chunks.join('')
      chunks = []
      bufferedBytes = 0
      report(text)
    }
    const outputTimer = setInterval(flush, 75)
    const stop = (reuse = false) => {
      clearTimeout(timer)
      clearInterval(outputTimer)
      flush()
      if (activeWorker === worker) {
        activeWorker = undefined
        cancelActive = undefined
      }
      setBrowserBuildActive(false)
      signal?.removeEventListener('abort', abort)
      worker.onmessage = null
      worker.onerror = null
      if (reuse && !idleWorker) {
        idleWorker = worker
      } else worker.terminate()
    }
    const abort = () => {
      stop()
      lifecycle('cancelled')
      reject(new DOMException('Build cancelled', 'AbortError'))
    }
    cancelActive = abort
    const timer = setTimeout(() => {
      stop()
      lifecycle('error')
      reject(new Error('Browser build exceeded 5 minutes'))
    }, 300_000)
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = (event) => {
      stop()
      lifecycle('error')
      reject(new Error(event.message || 'Browser compiler worker crashed'))
    }
    worker.onmessage = async ({ data }) => {
      if (data.kind === 'output') {
        chunks.push(data.text)
        bufferedBytes += data.text.length
        if (bufferedBytes >= 64 * 1024) flush()
      } else if (data.kind === 'timing') timing?.(data.event)
      else if (data.kind === 'result' || data.kind === 'preloaded') {
        try {
          const artifacts = await Promise.all(
            data.result.artifacts.map(
              async (artifact: {
                path: string
                bytes?: Uint8Array
                digest?: string
                size?: number
              }) => {
                if (!artifact.digest) {
                  if (!(artifact.bytes instanceof Uint8Array))
                    throw new Error('Missing build artifact')
                  return { path: artifact.path, bytes: artifact.bytes }
                }
                let bytes = stableArtifacts.get(artifact.digest)
                if (artifact.bytes) {
                  if (
                    artifact.bytes.length !== artifact.size ||
                    (await buildCacheKey([artifact.bytes])) !== artifact.digest
                  )
                    throw new Error('Build artifact integrity mismatch')
                  bytes = artifact.bytes.slice()
                  // One retained cold package, owned separately from public results.
                  stableArtifacts.clear()
                  stableArtifacts.set(artifact.digest, bytes)
                }
                if (!bytes || bytes.length !== artifact.size)
                  throw new Error('Missing retained cold artifact; retry build')
                return { path: artifact.path, bytes: bytes.slice() }
              },
            ),
          )
          if (signal?.aborted || activeWorker !== worker) return
          stop(true)
          lifecycle(data.result.exitCode ? 'error' : 'success')
          resolve({ ...data.result, artifacts })
        } catch (error) {
          if (activeWorker !== worker) return
          stableArtifacts.clear()
          stop()
          lifecycle('error')
          reject(error)
        }
      } else if (data.kind === 'error') {
        stop()
        lifecycle('error')
        reject(new Error(data.message))
      }
    }
    worker.postMessage({
      ...input,
      knownArtifacts: [...stableArtifacts.keys()],
    })
  })
}

/** Serialize worker ownership; snapshot at submission, not after a queued build. */
export function buildInBrowser(
  input: BrowserBuildInput,
  report: (text: string) => void,
  signal?: AbortSignal,
  timing?: (event: BuildTimingEvent) => void,
): Promise<BrowserBuildResult> {
  const snapshot = {
    ...input,
    files: { ...input.files },
    buildId: crypto.randomUUID(),
    trace: Boolean(timing),
  }
  const generation = sessionGeneration
  const result = buildQueue.then(() => {
    if (generation !== sessionGeneration)
      throw new DOMException('Build cancelled', 'AbortError')
    return executeBuild(snapshot, report, signal, timing)
  })
  buildQueue = result.catch(() => undefined)
  return result
}

export { readBrowserBuild, writeBrowserBuild } from './build-storage'

/** Preload only the selected SDK after editor readiness; unknown/low memory stays demand-loaded. */
export function scheduleBrowserCompilerPreload(input: BrowserBuildInput) {
  const navigatorWithHints = navigator as Navigator & {
    deviceMemory?: number
    connection?: { saveData?: boolean; effectiveType?: string }
  }
  if (
    !navigatorWithHints.deviceMemory ||
    navigatorWithHints.deviceMemory <= 4 ||
    navigatorWithHints.connection?.saveData ||
    /(^|-)2g$/.test(navigatorWithHints.connection?.effectiveType ?? '')
  )
    return () => {}
  const controller = new AbortController()
  const timer = setTimeout(() => {
    if (document.visibilityState !== 'visible' || activeWorker) return
    void buildInBrowser(
      { ...input, kind: 'preload' },
      () => {},
      controller.signal,
    ).catch(() => {})
  }, 10_000)
  return () => {
    clearTimeout(timer)
    controller.abort()
  }
}
