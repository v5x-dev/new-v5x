import { BrowserLspIndex, type BrowserFileSystem } from './browser-lsp-index'
import artifacts from '../../browser-lsp/artifacts.json'
import type {
  BrowserLspBoot,
  BrowserLspInput,
  BrowserLspOutput,
  SdkPack,
} from './browser-lsp-types'
import { safeWorkspacePath } from './browser-lsp-types'
import { compilationDatabase } from './browser-lsp-profile'

type ClangdModule = { FS: BrowserFileSystem; callMain(args: string[]): void }
const scope = self as unknown as {
  postMessage(message: BrowserLspOutput): void
  onmessage: ((event: MessageEvent<BrowserLspInput>) => void) | null
}
const encoder = new TextEncoder()
const decoder = new TextDecoder()
let module: ClangdModule | undefined
let booted = false
let failed = false
let stdinReady: (() => void) | undefined
const inputs: Uint8Array[] = []
let inputOffset = 0
let currentInput: Uint8Array | undefined
const queuedRpc: unknown[] = []

function fail(error: unknown) {
  if (failed) return
  failed = true
  scope.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  })
}

scope.onmessage = ({ data }) => {
  if (failed) return
  if (data.type === 'boot') {
    if (booted) return
    booted = true
    void boot(data).catch(fail)
  } else if (!module) queuedRpc.push(data.message)
  else receive(data.message)
}

async function cachedFetch(url: string): Promise<Response> {
  let cache: Cache | undefined
  try {
    cache = await caches.open('v5x-clangd-v1')
    const cached = await cache.match(url)
    if (cached) return cached
  } catch {
    /* Private browsing can disable persistent storage. */
  }
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`Could not load language server asset (${response.status})`)
  if (cache) {
    try {
      await cache.put(url, response.clone())
      for (const key of await cache.keys()) {
        if (
          new URL(key.url).pathname === new URL(url).pathname &&
          key.url !== url
        )
          await cache.delete(key)
      }
    } catch {
      /* Cache quota is optional. */
    }
  }
  return response
}

async function boot({
  files,
  template,
  assetBase,
  projectKey,
}: BrowserLspBoot) {
  const progress = (message: string) =>
    scope.postMessage({ type: 'progress', message })
  progress('Loading local C++ language server…')
  const base = new URL(assetBase)
  const assetUrl = (name: keyof typeof artifacts) => {
    const url = new URL(name, base)
    url.searchParams.set('sha256', artifacts[name].sha256)
    return url.href
  }
  const sdkNames =
    template === 'vexcode' || template === 'jar-template'
      ? ['vexcode']
      : template === 'ez-template'
        ? ['ez-template', 'pros']
        : ['pros']
  const [factory, wasmBinary, packs] = await Promise.all([
    import(/* @vite-ignore */ assetUrl('clangd.js')),
    cachedFetch(assetUrl('clangd.wasm')).then((response) =>
      response.arrayBuffer(),
    ),
    Promise.all(
      sdkNames.map(async (name) => {
        const response = await cachedFetch(
          assetUrl(`${name}.pack` as keyof typeof artifacts),
        )
        const stream = response.body!.pipeThrough(
          new DecompressionStream('gzip'),
        )
        return (await new Response(stream).json()) as SdkPack
      }),
    ),
  ])
  progress('Starting local clangd…')
  let output: number[] = []
  let bodyLength: number | undefined
  let header = ''
  const stdout = (byte: number) => {
    if (bodyLength === undefined) {
      header += String.fromCharCode(byte)
      if (header.endsWith('\r\n\r\n')) {
        const match = /Content-Length:\s*(\d+)/i.exec(header)
        if (!match) {
          fail(new Error('Invalid clangd output'))
          return
        }
        bodyLength = Number(match[1])
        header = ''
      }
    } else {
      output.push(byte)
      if (output.length === bodyLength) {
        try {
          scope.postMessage({
            type: 'rpc',
            message: JSON.parse(decoder.decode(new Uint8Array(output))),
          })
        } catch {
          fail(new Error('Invalid clangd JSON response'))
        }
        output = []
        bodyLength = undefined
      }
    }
  }
  module = (await factory.default({
    thisProgram: '/usr/bin/clangd',
    mainScriptUrlOrBlob: assetUrl('clangd.js'),
    wasmBinary,
    INITIAL_MEMORY: 256 * 1024 * 1024,
    noInitialRun: true,
    locateFile: (path: string) => new URL(path, base).href,
    stdinReady: () =>
      inputs.length
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            stdinReady = resolve
          }),
    stdin: () => {
      if (!currentInput) {
        currentInput = inputs.shift()
        inputOffset = 0
      }
      if (!currentInput) return null
      // Keep libc from reading ahead into the next header/body segment. The
      // upstream Asyncify patch waits before each fgets/fread operation.
      if (inputOffset === currentInput.length) {
        currentInput = undefined
        return null
      }
      return currentInput[inputOffset++]
    },
    stdout,
    stderr: () => {},
    onAbort: (message: string) =>
      fail(new Error(`Local clangd stopped: ${message}`)),
    onExit: (code: number) => {
      if (code !== 0) fail(new Error(`Local clangd exited (${code})`))
    },
  })) as ClangdModule
  module.FS.mkdirTree('/workspace')
  for (const pack of packs) {
    for (const file of pack.files) write(file.path, file.contents)
  }
  for (const file of files) {
    if (!safeWorkspacePath(file.path))
      throw new Error('Invalid project file path')
    write(`/workspace/${file.path}`, file.contents)
  }
  const commands = compilationDatabase(
    template,
    files,
    packs.flatMap((pack) => pack.includePaths),
  )
  write('/workspace/compile_commands.json', JSON.stringify(commands))
  const profileHash = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(
        JSON.stringify({
          commands,
          clangd: artifacts['clangd.wasm'].sha256,
          sdk: sdkNames.map(
            (name) =>
              artifacts[`${name}.pack` as keyof typeof artifacts].sha256,
          ),
          configuration: files.find((file) => file.path === '.clangd')
            ?.contents,
        }),
      ),
    ),
  )
  const index = new BrowserLspIndex(
    `${projectKey}:${Array.from(profileHash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
    module.FS,
  )
  await index.restore()
  module.callMain([
    '--compile-commands-dir=/workspace',
    '--background-index',
    '--background-index-priority=low',
    '--clang-tidy=false',
    '--pch-storage=memory',
    '-j=2',
    '--log=error',
  ])
  for (const message of queuedRpc.splice(0)) receive(message)
  setInterval(() => {
    void index.persist()
  }, 10_000)
  scope.postMessage({ type: 'ready' })
}

function write(path: string, contents: string) {
  module!.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')))
  module!.FS.writeFile(path, contents)
}

function receive(value: unknown) {
  const message = value as {
    id?: number | string
    method?: string
    params?: { path?: string; contents?: string }
  }
  if (message.method === 't3/syncFile') {
    const { path, contents } = message.params ?? {}
    if (
      typeof path !== 'string' ||
      typeof contents !== 'string' ||
      !safeWorkspacePath(path)
    ) {
      scope.postMessage({
        type: 'rpc',
        message: {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32602, message: 'Invalid project file' },
        },
      })
      return
    }
    write(`/workspace/${path}`, contents)
    scope.postMessage({
      type: 'rpc',
      message: { jsonrpc: '2.0', id: message.id, result: null },
    })
    enqueue({
      jsonrpc: '2.0',
      method: 'workspace/didChangeWatchedFiles',
      params: {
        changes: [
          {
            uri: `file:///workspace/${path.split('/').map(encodeURIComponent).join('/')}`,
            type: 2,
          },
        ],
      },
    })
  } else enqueue(value)
}

function enqueue(message: unknown) {
  const body = encoder.encode(JSON.stringify(message))
  const header = encoder.encode(`Content-Length: ${body.length}\r\n`)
  inputs.push(header, encoder.encode('\r\n'), body)
  stdinReady?.()
  stdinReady = undefined
}
