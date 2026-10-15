import { compilationServerUrl } from '@v5x/compiler/remote-build'

const languageProtocol = 'v5x-language-v1'
const maximumQueuedMessages = 256
const maximumQueuedBytes = 8 * 1024 * 1024

export function languageServerUrl(endpoint: string) {
  const url = new URL(compilationServerUrl(endpoint))
  if (url.pathname.endsWith('/compile'))
    url.pathname = `${url.pathname.slice(0, -'/compile'.length)}/language`
  else if (url.pathname !== '/language')
    throw new Error('Enter the compilation server URL.')
  return url.href
}

/** Worker-compatible LSP transport for the compilation server's native clangd. */
export class LanguageServerTransport extends EventTarget implements Worker {
  onmessage: Worker['onmessage'] = null
  onmessageerror: Worker['onmessageerror'] = null
  onerror: Worker['onerror'] = null

  private socket: WebSocket
  private connected = false
  private terminated = false
  private failed = false
  private serviceError = false
  private queue: Array<string> = []
  private queuedBytes = 0
  private connectTimer: ReturnType<typeof setTimeout>

  constructor(endpoint: string) {
    super()
    this.socket = new WebSocket(languageServerUrl(endpoint), languageProtocol)
    this.connectTimer = setTimeout(
      () => this.fail('Language server connection timed out'),
      10_000,
    )

    this.socket.onopen = () => {
      if (this.socket.protocol !== languageProtocol)
        this.fail('Language server protocol mismatch')
    }

    this.socket.onmessage = ({ data }) => this.receive(data)
    this.socket.onerror = () =>
      this.fail(
        'Could not connect to the language server. Check the URL, token, and TLS settings.',
      )
    this.socket.onclose = () => {
      if (!this.terminated && !this.failed && !this.serviceError)
        this.fail('Language server disconnected')
    }
  }

  postMessage(
    message: any,
    _transfer?: Transferable[] | StructuredSerializeOptions,
  ) {
    if (this.terminated || this.failed) return

    let encoded: string
    try {
      encoded = JSON.stringify(message)
    } catch {
      this.fail('Language server message could not be encoded')
      return
    }
    if (typeof encoded !== 'string') {
      this.fail('Invalid language server message')
      return
    }

    const size = new TextEncoder().encode(encoded).byteLength
    if (size > maximumQueuedBytes) {
      this.fail('Language server message exceeds the 8 MB limit')
      return
    }

    if (message?.kind === 'stop') {
      this.queue = []
      this.queuedBytes = 0
      if (this.connected) this.socket.send(encoded)
      this.terminate()
      return
    }

    if (this.connected) {
      this.send(encoded)
      return
    }

    if (
      this.queue.length >= maximumQueuedMessages ||
      this.queuedBytes + size > maximumQueuedBytes
    ) {
      this.fail('Language server startup queue is full')
      return
    }
    this.queue.push(encoded)
    this.queuedBytes += size
  }

  terminate() {
    if (this.terminated) return
    this.terminated = true
    clearTimeout(this.connectTimer)
    this.queue = []
    this.queuedBytes = 0
    this.socket.close(1000, 'Stopped')
  }

  private receive(data: unknown) {
    if (typeof data !== 'string' || data.length > maximumQueuedBytes * 1.4) {
      this.fail('Invalid language server response')
      return
    }

    let message: any
    try {
      message = JSON.parse(data)
    } catch {
      this.fail('Invalid language server response')
      return
    }

    if (message?.type === 'ready') {
      if (this.connected || message.protocol !== languageProtocol) {
        this.fail('Language server protocol mismatch')
        return
      }
      this.connected = true
      clearTimeout(this.connectTimer)
      for (const encoded of this.queue) this.send(encoded)
      this.queue = []
      this.queuedBytes = 0
      return
    }

    if (!message || typeof message.kind !== 'string') {
      this.fail('Invalid language server response')
      return
    }
    if (message.kind === 'error') this.serviceError = true
    const event = new MessageEvent('message', { data: message })
    this.dispatchEvent(event)
    this.onmessage?.call(this, event)
  }

  private send(encoded: string) {
    if (this.socket.bufferedAmount > maximumQueuedBytes) {
      this.fail('Language server client is not keeping up')
      return
    }
    try {
      this.socket.send(encoded)
    } catch {
      this.fail('Could not send a message to the language server')
    }
  }

  private fail(message: string) {
    if (this.failed || this.terminated) return
    this.failed = true
    clearTimeout(this.connectTimer)
    this.queue = []
    this.queuedBytes = 0
    const error = new ErrorEvent('error', {
      message,
      error: new Error(message),
    })
    this.dispatchEvent(error)
    this.onerror?.call(this, error)
    this.socket.close()
  }
}
