import type {
  BrowserLspOutput,
  RobotTemplate,
  WorkspaceFile,
} from './browser-lsp-types'

export class BrowserLspTransport {
  private worker: Worker | null = null
  private rejectStart?: (error: Error) => void
  ready = false
  onMessage: (message: unknown) => void = () => {}
  onDisconnect: (error: Error) => void = () => {}

  constructor(
    private readonly projectKey: string,
    private readonly template: RobotTemplate,
    private readonly files: WorkspaceFile[],
    private readonly onProgress: (message: string) => void,
  ) {}

  start() {
    if (!window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined')
      return Promise.reject(
        new Error('C++ tools are unavailable. Reload the page to try again.'),
      )
    const worker = new Worker(
      new URL('./browser-lsp.worker.ts', import.meta.url),
      { type: 'module' },
    )
    this.worker = worker
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.close()
        reject(
          new Error(
            'C++ tools took too long to start. Reload the page to try again.',
          ),
        )
      }, 180_000)
      this.rejectStart = (error) => {
        window.clearTimeout(timeout)
        reject(error)
      }
      const fail = (error: Error) => {
        this.rejectStart?.(error)
        this.rejectStart = undefined
        this.close()
        this.onDisconnect(error)
      }
      worker.onmessage = ({ data }: MessageEvent<BrowserLspOutput>) => {
        if (data.type === 'progress') this.onProgress(data.message)
        else if (data.type === 'rpc') this.onMessage(data.message)
        else if (data.type === 'error')
          fail(
            new Error(
              'C++ tools could not start. Reload the page to try again.',
            ),
          )
        else if (data.type === 'ready') {
          window.clearTimeout(timeout)
          this.rejectStart = undefined
          this.ready = true
          resolve()
        }
      }
      worker.onerror = () => fail(new Error('C++ tools could not start'))
      worker.onmessageerror = () =>
        fail(new Error('Could not read a C++ tools response'))
      worker.postMessage({
        type: 'boot',
        projectKey: this.projectKey,
        template: this.template,
        files: this.files,
        assetBase: new URL('/lsp/v1/', window.location.origin).href,
      })
    })
  }

  send(message: unknown) {
    if (!this.ready || !this.worker) throw new Error('C++ tools are not ready')
    this.worker.postMessage({ type: 'rpc', message })
  }

  close() {
    this.ready = false
    this.worker?.terminate()
    this.worker = null
    this.rejectStart?.(new Error('C++ tools were closed'))
    this.rejectStart = undefined
  }
}
