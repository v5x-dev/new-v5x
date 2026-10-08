/* Local-only classic worker bridge for @clangd-wasm/core 15.0.7. */
// JAR's umbrella headers depend on include order. User style files take precedence.
const defaultFormatStyle = 'BasedOnStyle: LLVM\nSortIncludes: Never\n'
const projectFormatFiles = new Set()

let runtime

let starting = false

let indexPrefix = null

let persistingIndex = false

// Keep clangd's stdout in one capped buffer. A completion reply used to be
// stored as one JavaScript number per byte, and a failed parse left that
// array growing for the rest of the session.
function createLspStdout(onMessage, onError, maxMessage = 8 * 1024 * 1024) {
  const decoder = new TextDecoder()
  let header = []
  let expected = null
  let body = null
  let received = 0
  let skip = 0

  return (byte) => {
    if (skip > 0) {
      skip -= 1
      return
    }

    if (expected === null) {
      header.push(byte)

      if (header.length > 8192) {
        header = []
        throw new Error('Invalid clangd output header')
      }

      if (
        header.length < 4 ||
        header[header.length - 4] !== 13 ||
        header[header.length - 3] !== 10 ||
        header[header.length - 2] !== 13 ||
        header[header.length - 1] !== 10
      )
        return

      const match = /Content-Length:\s*(\d+)/i.exec(
        decoder.decode(Uint8Array.from(header)),
      )
      header = []

      if (!match) throw new Error('Missing clangd message length')

      const length = Number(match[1])

      if (!Number.isSafeInteger(length))
        throw new Error('Invalid clangd message length')

      if (length > maxMessage) {
        skip = length
        onError('Clangd response exceeded the memory limit')
        return
      }

      if (length === 0) {
        onMessage(null)
        return
      }

      expected = length
      body = new Uint8Array(length)
      return
    }

    body[received] = byte
    received += 1

    if (received < expected) return

    const bytes = body
    expected = null
    body = null
    received = 0

    try {
      onMessage(JSON.parse(decoder.decode(bytes)))
    } catch {
      onError('Clangd response could not be read')
    }
  }
}

const stdout = createLspStdout(
  (message) => {
    try {
      self.postMessage({ kind: 'rpc', message })
    } catch {
      self.postMessage({
        kind: 'error',
        message: 'Clangd response was too large to deliver',
      })
    }
  },
  (message) => self.postMessage({ kind: 'error', message }),
)

function writeFile(path, contents) {
  if (
    path.split('/').some((part) => part === '..' || part === '.') ||
    path.includes('\\') ||
    path.includes('\0')
  )
    throw new Error('Invalid virtual filesystem path')
  if (
    !path.startsWith('/workspace/') &&
    !path.startsWith('/sdk/') &&
    !path.startsWith('/toolchain/')
  )
    throw new Error('Invalid virtual filesystem path')
  runtime.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')))
  runtime.FS.writeFile(path, contents)
}

async function cachedBytes(url, expectedHash) {
  const cache = await caches.open('v5x-language-assets-v1')
  let response = await cache.match(url)

  if (!response) {
    response = await fetch(url)
    if (!response.ok)
      throw new Error(`Could not download language asset (${response.status})`)
  }

  const bytes = await response.arrayBuffer()
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
  if (digest !== expectedHash) {
    await cache.delete(url)
    throw new Error('Language asset checksum mismatch')
  }
  await cache.put(url, new Response(bytes))
  return bytes
}

self.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'start') {
      if (starting) return
      starting = true
      if (!self.crossOriginIsolated)
        throw new Error(
          'Local clangd requires cross-origin isolation. Reload after enabling COOP/COEP headers.',
        )
      const base = new URL('/language/clangd-15.0.7/', self.location.origin)
        .href
      self.postMessage({ kind: 'status', status: 'Downloading clangd' })
      const manifestResponse = await fetch(base + 'manifest.json', {
        cache: 'no-cache',
      })
      if (!manifestResponse.ok)
        throw new Error(
          'Run bun run prepare:language to install local clangd assets',
        )
      const manifest = await manifestResponse.json()
      const wasmBinary = await cachedBytes(
        base + 'clangd.wasm',
        manifest.files['clangd.wasm'],
      )
      self.postMessage({ kind: 'status', status: 'Loading SDK headers' })
      const sdkResponse = await fetch('/language/sdk-manifest.json')
      if (!sdkResponse.ok) throw new Error('Language SDK manifest is missing')
      const sdk = await sdkResponse.json()
      const names = sdk.templates[data.template]
      if (!names) throw new Error(`Missing ${data.template} SDK configuration`)
      const bundles = names.map((name) => {
        const bundle = sdk.bundles[name]
        if (!bundle) throw new Error(`Missing ${name} language SDK`)
        return bundle
      })
      const namespace = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(data.workspaceId),
          ),
        ),
        (b) => b.toString(16).padStart(2, '0'),
      )
        .join('')
        .slice(0, 16)
      const fingerprint = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(
              JSON.stringify({
                files: data.files,
                commands: data.commands,
                sdk,
              }),
            ),
          ),
        ),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('')
      indexPrefix = new URL(
        `/__v5x-index/${namespace}/${fingerprint}/`,
        self.location.origin,
      ).href
      const indexCache = await caches.open('v5x-clangd-index-v1')
      const cachedIndex = {}
      const keys = await indexCache.keys()

      for (const key of keys.filter((key) => key.url.startsWith(indexPrefix))) {
        const response = await indexCache.match(key)
        if (response)
          cachedIndex[
            '/workspace/.cache/clangd/index/' +
              decodeURIComponent(key.url.slice(indexPrefix.length))
          ] = new Uint8Array(await response.arrayBuffer())
      }

      // Keep at most two older snapshots for each workspace.
      const prefixes = [
        ...new Set(
          keys
            .filter((key) => key.url.includes(`/__v5x-index/${namespace}/`))
            .map((key) => key.url.slice(0, key.url.lastIndexOf('/') + 1)),
        ),
      ].filter((prefix) => prefix !== indexPrefix)
      for (const prefix of prefixes.slice(0, Math.max(0, prefixes.length - 2)))
        for (const key of keys.filter((key) => key.url.startsWith(prefix)))
          await indexCache.delete(key)
      const files = {}

      for (const bundle of bundles) {
        const bytes = await cachedBytes(
          new URL(bundle.url, self.location.origin).href,
          bundle.sha256,
        )
        const json = await new Response(
          new Blob([bytes])
            .stream()
            .pipeThrough(new DecompressionStream('gzip')),
        ).json()
        Object.assign(files, json.files)
      }

      for (const [path, contents] of Object.entries(data.files)) {
        files['/workspace/' + path] = contents
        if (path === '.clang-format' || path === '_clang-format')
          projectFormatFiles.add(path)
      }
      if (!projectFormatFiles.size)
        files['/workspace/.clang-format'] = defaultFormatStyle
      files['/workspace/compile_commands.json'] = JSON.stringify(data.commands)
      self.postMessage({ kind: 'status', status: 'Starting clangd' })
      importScripts(base + 'clangd.js')

      const options = {
        wasmBinary,
        messageBuf: [],
        noFSInit: true,
        arguments: [
          '--compile-commands-dir=/workspace',
          '--background-index',
          // One worker, and preambles on the virtual disk. Memory storage
          // keeps every completion preamble in the WASM heap, which cannot
          // shrink and is capped at 2GB.
          '-j=1',
          '--pch-storage=disk',
          '--limit-results=20',
          '--log=error',
          '--enable-config',
          '--clang-tidy',
        ],
        mainScriptUrlOrBlob: base + 'clangd.js',
        locateFile: (path) => base + path,
        onAbort: (reason) =>
          self.postMessage({ kind: 'error', message: String(reason) }),
        preRun: [
          (module) => {
            runtime = module
            module.FS.init(
              () => null,
              stdout,
              () => {},
            )
            for (const [path, contents] of Object.entries(files))
              writeFile(path, contents)
            for (const [path, contents] of Object.entries(cachedIndex))
              writeFile(path, contents)
            module.FS.chdir('/workspace')
          },
        ],
      }

      runtime = await createClangdModule(options)
      self.postMessage({ kind: 'started' })
      setInterval(() => {
        void persistIndex().catch(() => {})
      }, 20_000)
    } else if (data.kind === 'rpc') {
      if (!runtime) throw new Error('clangd has not started')
      runtime.messageBuf.push(data.message)
    } else if (data.kind === 'files') {
      let formatChanged = false
      for (const [path, contents] of Object.entries(data.files)) {
        if (path === '.clang-format' || path === '_clang-format') {
          formatChanged = true
          if (contents === null) projectFormatFiles.delete(path)
          else projectFormatFiles.add(path)
        }
        if (contents === null) {
          try {
            runtime.FS.unlink('/workspace/' + path)
          } catch {}
        } else writeFile('/workspace/' + path, contents)
      }
      if (formatChanged) {
        if (!projectFormatFiles.size)
          writeFile('/workspace/.clang-format', defaultFormatStyle)
        else if (!projectFormatFiles.has('.clang-format')) {
          try {
            runtime.FS.unlink('/workspace/.clang-format')
          } catch {}
        }
      }
    } else if (data.kind === 'read') {
      try {
        self.postMessage({
          kind: 'read',
          id: data.id,
          contents: runtime.FS.readFile(data.path, { encoding: 'utf8' }),
        })
      } catch {
        self.postMessage({
          kind: 'read',
          id: data.id,
          error: { message: 'Header is not available in the local SDK' },
        })
      }
    } else if (data.kind === 'stop') {
      runtime?.PThread?.terminateAllThreads()
      self.close()
    }
  } catch (error) {
    self.postMessage({
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

async function persistIndex() {
  if (persistingIndex || !runtime || !indexPrefix) return
  const directory = '/workspace/.cache/clangd/index'
  let entries
  try {
    entries = runtime.FS.readdir(directory).filter(
      (name) => name !== '.' && name !== '..',
    )
  } catch {
    return
  }
  persistingIndex = true

  try {
    const cache = await caches.open('v5x-clangd-index-v1')
    let bytes = 0

    for (const name of entries) {
      const data = runtime.FS.readFile(directory + '/' + name)
      bytes += data.byteLength
      if (bytes > 16 * 1024 * 1024) break
      await cache.put(
        indexPrefix + encodeURIComponent(name),
        new Response(data),
      )
    }
  } finally {
    persistingIndex = false
  }
}
