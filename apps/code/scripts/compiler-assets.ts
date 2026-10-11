import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Plugin } from 'vite'

/** Nitro dev recompresses every public response, including gzip SDK bundles. */
export function compilerAssets(): Plugin {
  return {
    name: 'compiler-assets',
    configureServer(server) {
      const directory = resolve(server.config.publicDir)
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next()
        let pathname: string
        try {
          pathname = decodeURIComponent(
            new URL(request.url ?? '/', 'http://localhost').pathname,
          )
        } catch {
          return next()
        }
        if (
          !/^\/(?:compiler|language)\/.+\.(?:wasm|tar|bundle|gz|br)$/.test(
            pathname,
          )
        )
          return next()
        const original = resolve(directory, '.' + pathname)
        if (!original.startsWith(directory + '/')) return next()
        let file = original
        let encoding: string | undefined
        const accepts = request.headers['accept-encoding'] ?? ''
        // Bundles and explicit compressed companions already contain gzip bytes.
        if (/\.(?:wasm|tar)$/.test(original)) {
          for (const candidate of ['br', 'gzip']) {
            const suffix = candidate === 'br' ? '.br' : '.gz'
            if (!new RegExp(`\\b${candidate}\\b`).test(accepts)) continue
            if (
              (await stat(original + suffix).catch(() => undefined))?.isFile()
            ) {
              file = original + suffix
              encoding = candidate
              break
            }
          }
        }
        const metadata = await stat(file).catch(() => undefined)
        if (!metadata?.isFile()) return next()
        const types: Record<string, string> = {
          '.wasm': 'application/wasm',
          '.tar': 'application/x-tar',
          '.gz': 'application/gzip',
        }
        response.setHeader(
          'Content-Type',
          types[extname(original)] ?? 'application/octet-stream',
        )
        response.setHeader('Content-Length', metadata.size)
        response.setHeader('Cache-Control', 'no-cache')
        response.setHeader('Vary', 'Accept-Encoding')
        if (encoding) response.setHeader('Content-Encoding', encoding)
        if (request.method === 'HEAD') {
          response.end()
          return
        }
        try {
          await pipeline(createReadStream(file), response)
        } catch (error) {
          if (!response.destroyed) response.destroy(error as Error)
        }
      })
    },
  }
}
