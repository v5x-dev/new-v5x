import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assetLoader } from "./assets"

test("verifies downloads, reuses cached assets, and repairs corrupt cache entries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "v5x-asset-test-"))
  const contents = new Uint8Array([1, 2, 3, 4])
  const sha256 = Bun.CryptoHasher.hash("sha256", contents, "hex")
  let requests = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests++
      return new Response(contents)
    },
  })
  try {
    const loader = assetLoader(`http://127.0.0.1:${server.port}`, directory)
    const asset = { url: "/compiler/test", sha256, bytes: contents.length }
    expect(await loader.load(asset)).toEqual(contents)
    expect(await loader.load(asset)).toEqual(contents)
    expect(requests).toBe(1)
    await writeFile(join(directory, sha256), new Uint8Array([9, 9, 9, 9]))
    expect(await loader.load(asset)).toEqual(contents)
    expect(requests).toBe(2)
    expect(new Uint8Array(await readFile(join(directory, sha256)))).toEqual(
      contents
    )
  } finally {
    server.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects checksum mismatches and assets outside the configured host", async () => {
  const directory = await mkdtemp(join(tmpdir(), "v5x-asset-test-"))
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response("wrong")
    },
  })
  try {
    const loader = assetLoader(`http://127.0.0.1:${server.port}`, directory)
    const asset = { url: "/compiler/test", sha256: "0".repeat(64), bytes: 5 }
    let message = ""
    try {
      await loader.load(asset)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain("checksum mismatch")
    try {
      await loader.load({
        ...asset,
        url: "https://untrusted.example/compiler/test",
      })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain("configured asset server")
  } finally {
    server.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
})
