export interface BuildAsset {
  url: string
  sha256: string
  bytes: number
}

export interface BuildSdkManifest {
  version: number
  gccVersion: string
  templates: Partial<Record<string, Array<string>>>
  bundles: Partial<Record<string, BuildAsset>>
  precompiled?: Partial<
    Record<string, { binary: BuildAsset; metadata: BuildAsset }>
  >
}

export async function cachedBuildAsset(asset: BuildAsset): Promise<Uint8Array> {
  const cache = await caches.open('v5x-browser-build-assets-v1')
  const cached = await cache.match(asset.url)
  const response = cached ?? (await fetch(asset.url))
  if (!response.ok)
    throw new Error(`Could not download ${asset.url} (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
  if (bytes.byteLength !== asset.bytes || digest !== asset.sha256) {
    await cache.delete(asset.url)
    throw new Error(`Build asset checksum mismatch: ${asset.url}`)
  }
  if (!cached) {
    await cache
      .put(
        asset.url,
        new Response(bytes, {
          headers: {
            'Content-Type': asset.url.endsWith('.wasm')
              ? 'application/wasm'
              : 'application/octet-stream',
          },
        }),
      )
      .catch((error) => console.warn('Could not cache compiler asset:', error))
  }
  return bytes
}

export async function cachedBuildManifest<T>(url: string): Promise<T> {
  const cache = await caches.open('v5x-browser-build-assets-v1')
  let response: Response
  try {
    response = await fetch(url, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`Build manifest is missing: ${url}`)
  } catch (error) {
    const cached = await cache.match(url)
    if (cached) return cached.json()
    throw error
  }
  const value: T = await response.clone().json()
  await cache
    .put(url, response)
    .catch((error) => console.warn('Could not cache compiler manifest:', error))
  return value
}

export async function unpackBuildBundle(asset: BuildAsset, binary: boolean) {
  const bytes = await cachedBuildAsset(asset)
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  const bundle = (await new Response(stream).json()) as {
    files: Record<string, string>
  }
  return Object.entries(bundle.files).map(
    ([path, contents]) =>
      [
        path,
        binary
          ? Uint8Array.from(atob(contents), (char) => char.charCodeAt(0))
          : contents,
      ] as const,
  )
}
