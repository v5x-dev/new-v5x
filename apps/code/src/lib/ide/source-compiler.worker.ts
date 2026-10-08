import { createSession, setAssetLoader } from 'microbit-clang-wasm'
import { cachedBuildAsset, unpackBuildBundle } from './build-assets'
import { BrowserBuildSession } from './build-session'
import type { BuildAsset, BuildSdkManifest } from './build-assets'
import type { BrowserBuildInput } from './browser-build'

// Experimental independent compiler filesystem. The parent alone owns linking and caches.
let queue: Promise<unknown> = Promise.resolve()
let state: BrowserBuildSession | undefined
let owner: string | undefined
self.onmessage = ({
  data,
}: MessageEvent<{
  id: number
  input: BrowserBuildInput
  compiler: { files: Partial<Record<string, Omit<BuildAsset, 'url'>>> }
  headers: BuildSdkManifest
  argv: Array<string>
  object: string
}>) => {
  queue = queue
    .catch(() => {})
    .then(async () => {
      try {
        if (!state || owner !== data.input.buildId) {
          const { compiler, headers } = data
          setAssetLoader((name) => {
            const asset = compiler.files[name]
            if (!asset) throw new Error('Unknown parallel compiler asset')
            return cachedBuildAsset({
              ...asset,
              url: '/compiler/llvm-21.11.0-alpha.1/' + name,
            })
          })
          state = new BrowserBuildSession(createSession())
          const bundles = await Promise.all(
            (headers.templates[data.input.template] ?? []).map((name) =>
              unpackBuildBundle(headers.bundles[name]!, false),
            ),
          )
          await state.mount(bundles.flat())
          await state.synchronize(data.input.files)
          owner = data.input.buildId
        }
        let output = ''
        const decoder = new TextDecoder()
        const stream = (bytes: Uint8Array | null) => {
          output = (
            output +
            (bytes ? decoder.decode(bytes, { stream: true }) : decoder.decode())
          ).slice(-400 * 1024)
        }
        const code = await state.session.run(data.argv, {
          stdout: stream,
          stderr: stream,
        })
        const bytes = code ? null : await state.session.readFile(data.object)
        const dependencies = code
          ? null
          : await state.session.readFile(data.object + '.d')
        self.postMessage(
          { id: data.id, code, output, bytes, dependencies },
          {
            transfer: [bytes, dependencies].flatMap((value) =>
              value ? [value.buffer] : [],
            ),
          },
        )
      } catch (error) {
        state = undefined
        self.postMessage({
          id: data.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
}
