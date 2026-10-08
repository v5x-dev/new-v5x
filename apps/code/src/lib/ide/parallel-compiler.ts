import type { BuildAsset, BuildSdkManifest } from './build-assets'
import type { BrowserBuildInput } from './browser-build'

type SourceResult = {
  code: number
  output: string
  bytes: Uint8Array | null
  dependencies: Uint8Array | null
}
export function experimentalSourceCompiler(
  input: BrowserBuildInput,
  compiler: { files: Partial<Record<string, Omit<BuildAsset, 'url'>>> },
  headers: BuildSdkManifest,
) {
  const worker = new Worker(
    new URL('./source-compiler.worker.ts', import.meta.url),
    { type: 'module' },
  )
  let nextId = 0
  let stopped = false
  const jobs = new Map<
    number,
    {
      resolve: (value: SourceResult) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const dispose = () => {
    stopped = true
    worker.terminate()
    for (const job of jobs.values()) {
      clearTimeout(job.timer)
      job.reject(new Error('Parallel compiler stopped'))
    }
    jobs.clear()
  }
  worker.onerror = () => dispose()
  worker.onmessage = ({ data }) => {
    const job = jobs.get(data.id)
    if (!job) return
    jobs.delete(data.id)
    clearTimeout(job.timer)
    if (data.error) job.reject(new Error(data.error))
    else job.resolve(data)
  }
  return {
    dispose,
    compile(argv: Array<string>, object: string) {
      return new Promise<SourceResult>((resolve, reject) => {
        if (stopped) {
          reject(new Error('Parallel compiler stopped'))
          return
        }
        const id = ++nextId
        const timer = setTimeout(dispose, 120_000)
        jobs.set(id, { resolve, reject, timer })
        worker.postMessage({ id, input, compiler, headers, argv, object })
      })
    },
  }
}
