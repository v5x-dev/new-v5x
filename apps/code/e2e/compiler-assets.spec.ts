import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { BuildSdkManifest } from '@v5x/compiler/build-assets'

test('explicit gzip SDK downloads preserve the manifest payload', async ({
  request,
}) => {
  const manifestResponse = await request.get('/compiler/sdk-manifest.json')
  expect(manifestResponse.ok()).toBe(true)
  const manifest = (await manifestResponse.json()) as BuildSdkManifest
  const assets = Object.values(manifest.bundles ?? {}).filter((asset) =>
    asset?.url.endsWith('.gz'),
  )
  expect(assets.length).toBeGreaterThan(0)

  for (const asset of assets) {
    const response = await request.get(asset!.url)
    expect(response.ok(), asset!.url).toBe(true)
    const body = await response.body()
    expect(body.length, asset!.url).toBe(asset!.bytes)
    expect(createHash('sha256').update(body).digest('hex'), asset!.url).toBe(
      asset!.sha256,
    )
  }
})
