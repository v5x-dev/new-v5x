import { buildCacheKey } from './build-cache'
import { normalizeLinkerScript } from './cold-sdk'
import { validPath } from './workspace'
import { sdkPchHeader } from './sdk-pch'
import type { BuildBundleFile } from './build-archive'
import type { Session } from 'microbit-clang-wasm'

type FileIdentity = {
  digest: string
  timeSensitive: boolean
  linkerDigest?: string
}

/** Owns one mounted SDK and one immutable workspace snapshot at a time. */
export class BrowserBuildSession {
  projectPch?: {
    args: string
    inventory: string
    paths: Array<string>
    digest: string
    path: string
  }
  private project = new Map<string, string>()
  private baseline = new Map<string, string | Uint8Array>()
  private unsafeIncludes = false
  private digests = new Map<string, Promise<FileIdentity | undefined>>()
  private sdkPrefix?: string
  private dependencyKeys = new Map<
    string,
    {
      identities: Array<Promise<FileIdentity | undefined>>
      digest: Promise<string | undefined>
      size: number
    }
  >()
  private dependencyKeySize = 0

  constructor(readonly session: Session) {}

  async mount(files: Array<BuildBundleFile>) {
    for (const [path, contents, digest] of files) {
      this.baseline.set(path, contents)
      if (digest && !path.endsWith('/v5-common.ld'))
        this.digests.set(
          path,
          Promise.resolve({
            digest,
            timeSensitive:
              !/\.(a|o|elf|pch|bin)$/.test(path) &&
              /__DATE__|__TIME__|__TIMESTAMP__/.test(
                typeof contents === 'string'
                  ? contents
                  : new TextDecoder().decode(contents),
              ),
          }),
        )
      if (typeof contents === 'string' && uncertainIncludes(contents))
        this.unsafeIncludes = true
    }
    for (const [path, contents] of this.baseline)
      await this.session.writeFile(path, contents)
  }

  async synchronize(files: Record<string, string>) {
    // Validate the entire snapshot before changing the filesystem.
    for (const path of Object.keys(files)) {
      if (
        !validPath(path) ||
        path === '.browser-pch' ||
        path.startsWith('.browser-pch/') ||
        path === '.browser-build' ||
        path.startsWith('.browser-build/')
      )
        throw new Error(`Invalid project path: ${path}`)
    }
    await this.session.remove('/workspace/.browser-build')
    for (const path of this.digests.keys())
      if (path.startsWith('/workspace/.browser-build/'))
        this.digests.delete(path)
    let written = 0
    let removed = 0
    for (const path of this.project.keys()) {
      if (Object.hasOwn(files, path)) continue
      const absolute = `/workspace/${path}`
      const original = this.baseline.get(absolute)
      if (original === undefined) await this.session.remove(absolute)
      else await this.session.writeFile(absolute, original)
      this.digests.delete(absolute)
      removed++
    }
    for (const [path, contents] of Object.entries(files)) {
      if (this.project.get(path) === contents) continue
      const absolute = `/workspace/${path}`
      await this.session.writeFile(absolute, contents)
      this.digests.delete(absolute)
      written++
    }
    this.project = new Map(Object.entries(files))
    return { written, removed }
  }

  inventory(files: Record<string, string>) {
    const conservative =
      this.unsafeIncludes ||
      Boolean(files['compile_commands.json']) ||
      Object.entries(files).some(([, text]) => uncertainIncludes(text))
    return includeInventory(Object.keys(files), conservative)
  }

  /** Compiler outputs and normalized scripts must invalidate the same digest map. */
  async writeFile(path: string, contents: string | Uint8Array) {
    if (path === sdkPchHeader) this.sdkPrefix = undefined
    this.digests.delete(path)
    await this.session.writeFile(path, contents)
  }

  async synchronizeSdkPrefix(header: string) {
    if (this.sdkPrefix === header) return
    await this.writeFile(sdkPchHeader, header)
    this.sdkPrefix = header
  }

  /** Reuse an aggregate only while every input retains its immutable identity. */
  dependencyKey(paths: Array<string>) {
    paths = [...paths]
    const key = JSON.stringify(paths)
    const identities = paths.map((path) => this.fileIdentity(path))
    const retained = this.dependencyKeys.get(key)
    if (
      retained &&
      identities.every(
        (identity, index) => identity === retained.identities[index],
      )
    )
      return retained.digest
    const digest = Promise.all(identities).then((values) => {
      if (values.some((value) => !value || value.timeSensitive))
        return undefined
      return buildCacheKey(
        values.flatMap((value, index) => [paths[index], value!.digest]),
      )
    })
    if (retained) {
      this.dependencyKeySize -= retained.size
      this.dependencyKeys.delete(key)
    }
    const size = key.length * 2 + identities.length * 8
    if (size <= 2 * 1024 * 1024) {
      this.dependencyKeys.set(key, { identities, digest, size })
      this.dependencyKeySize += size
    }
    while (
      this.dependencyKeys.size > 64 ||
      this.dependencyKeySize > 2 * 1024 * 1024
    ) {
      const oldest = this.dependencyKeys.keys().next().value!
      this.dependencyKeySize -= this.dependencyKeys.get(oldest)!.size
      this.dependencyKeys.delete(oldest)
    }
    void digest.catch(() => {
      if (this.dependencyKeys.get(key)?.digest === digest) {
        this.dependencyKeySize -= this.dependencyKeys.get(key)!.size
        this.dependencyKeys.delete(key)
      }
    })
    return digest
  }

  private fileIdentity(path: string) {
    let identity = this.digests.get(path)
    if (!identity) {
      identity = this.session.readFile(path).then(async (contents) => {
        if (!contents) return undefined
        return {
          digest: await buildCacheKey([contents]),
          linkerDigest: path.endsWith('/v5-common.ld')
            ? await buildCacheKey([
                normalizeLinkerScript(new TextDecoder().decode(contents)),
              ])
            : undefined,
          timeSensitive:
            !/\.(a|o|elf|pch|bin)$/.test(path) &&
            /__DATE__|__TIME__|__TIMESTAMP__/.test(
              new TextDecoder().decode(contents),
            ),
        }
      })
      this.digests.set(path, identity)
    }
    return identity
  }

  async contentDigest(path: string) {
    return (await this.fileIdentity(path))?.digest
  }

  async linkerDigest(path: string) {
    const identity = await this.fileIdentity(path)
    return identity?.linkerDigest ?? identity?.digest
  }

  async dependencyDigest(path: string) {
    const identity = await this.fileIdentity(path)
    return identity?.timeSensitive ? undefined : identity?.digest
  }
}

/** Unknown extensions and source includes are conservative include candidates. */
export function includeInventory(paths: Array<string>, conservative = false) {
  return paths
    .filter(
      (path) =>
        conservative || !/\.(md|markdown|c|cc|cpp|cxx|c\+\+|s)$/i.test(path),
    )
    .sort()
}

function uncertainIncludes(text: string) {
  return (
    /__has_include(?:_next)?\s*\(\s*(?![<"])[^\s]|^\s*#\s*(?:include|include_next|import)\s+(?![<"])[^\s]/m.test(
      text,
    ) ||
    /#\s*(?:include|include_next|import)\s*[<"][^>"\n]*\.(?:md|markdown|c|cc|cpp|cxx|c\+\+|s)[>"]/i.test(
      text,
    ) ||
    /__has_include(?:_next)?\s*\(\s*[<"][^>"\n]*\.(?:md|markdown|c|cc|cpp|cxx|c\+\+|s)[>"]/i.test(
      text,
    )
  )
}

export function validDependencyRecord(value: unknown): value is {
  paths: Array<string>
  digest: string
} {
  if (!value || typeof value !== 'object') return false
  const { paths, digest } = value as { paths?: unknown; digest?: unknown }
  return (
    typeof digest === 'string' &&
    /^[a-f0-9]{64}$/.test(digest) &&
    Array.isArray(paths) &&
    paths.length > 0 &&
    paths.length <= 20000 &&
    paths.every(
      (path) =>
        typeof path === 'string' &&
        path.length < 4096 &&
        /^\/(?:workspace|sdk|toolchain)\/|^\/usr\/lib\/clang\/21\/include\//.test(
          path,
        ) &&
        !path.split('/').some((part) => part === '..' || part === '.') &&
        !path.includes('\0'),
    )
  )
}
