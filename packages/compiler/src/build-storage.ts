import { buildCacheKey } from './build-cache'
import type { BrowserBuildResult } from './browser-build'

type ArtifactReference = { path: string; digest: string; size: number }
type StoredBuild = Omit<BrowserBuildResult, 'artifacts'> & {
  version: number
  storedAt?: number
  artifacts: Array<ArtifactReference>
}
type StoredBlob = { bytes: Uint8Array; size: number }
const byteLimit = 128 * 1024 * 1024
const buildLimit = 32
const artifactLimit = 32 * 1024 * 1024
const buildArtifactLimit = 16 * 1024 * 1024

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    // Upgrade the existing store. Legacy inline records remain readable and migrate on write.
    const request = indexedDB.open('v5x-browser-builds-v2', 2)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('builds'))
        request.result.createObjectStore('builds')
      if (!request.result.objectStoreNames.contains('blobs'))
        request.result.createObjectStore('blobs')
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () =>
      reject(new Error('Build storage upgrade is blocked by another tab'))
  })
}

function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function validResult(value: unknown): value is BrowserBuildResult {
  if (!value || typeof value !== 'object') return false
  const result = value as BrowserBuildResult
  if (
    typeof result.commitSha !== 'string' ||
    result.commitSha.length > 128 ||
    !Number.isInteger(result.exitCode) ||
    typeof result.output !== 'string' ||
    result.output.length > 450 * 1024 ||
    !Array.isArray(result.artifacts) ||
    result.artifacts.length > 16 ||
    (result.exitCode !== 0 && result.artifacts.length > 0)
  )
    return false

  let totalBytes = 0
  for (const artifact of result.artifacts) {
    if (
      !/^(build|bin)\/[\w./-]+\.bin$/.test(artifact.path) ||
      artifact.path.split('/').includes('..') ||
      !(artifact.bytes instanceof Uint8Array) ||
      artifact.bytes.byteLength > artifactLimit ||
      artifact.path === 'bin/monolith.bin'
    )
      return false

    totalBytes += artifact.bytes.byteLength
    if (totalBytes > buildArtifactLimit) return false
  }

  return (
    new Set(result.artifacts.map((artifact) => artifact.path)).size ===
    result.artifacts.length
  )
}

export async function readBrowserBuild(
  workspaceId: string,
): Promise<BrowserBuildResult | undefined> {
  const db = await database()
  try {
    const transaction = db.transaction(['builds', 'blobs'])
    const stored: unknown = await requestValue(
      transaction.objectStore('builds').get(workspaceId),
    )
    if (!stored || typeof stored !== 'object') return undefined
    if (!('version' in stored)) return validResult(stored) ? stored : undefined
    const record = stored as StoredBuild
    if (
      record.version !== 1 ||
      !Array.isArray(record.artifacts) ||
      record.artifacts.length > 16
    )
      return undefined
    let totalBytes = 0
    for (const artifact of record.artifacts) {
      if (
        !artifact ||
        !/^[a-f0-9]{64}$/.test(artifact.digest) ||
        !Number.isSafeInteger(artifact.size) ||
        artifact.size < 0 ||
        artifact.size > artifactLimit
      )
        return undefined
      totalBytes += artifact.size
      if (totalBytes > buildArtifactLimit) return undefined
    }
    const blobs = await Promise.all(
      record.artifacts.map((artifact: ArtifactReference) => {
        return requestValue<StoredBlob | undefined>(
          transaction.objectStore('blobs').get(artifact.digest),
        )
      }),
    )
    const artifacts: BrowserBuildResult['artifacts'] = []
    for (let index = 0; index < blobs.length; index++) {
      const blob = blobs[index]
      const reference = record.artifacts[index]
      if (
        !(blob?.bytes instanceof Uint8Array) ||
        blob.bytes.byteLength !== reference.size ||
        blob.size !== reference.size ||
        (await buildCacheKey([blob.bytes])) !== reference.digest
      )
        return undefined
      artifacts.push({ path: reference.path, bytes: blob.bytes })
    }
    const result = {
      commitSha: record.commitSha,
      exitCode: record.exitCode,
      output: record.output,
      artifacts,
    }
    return validResult(result) ? result : undefined
  } catch {
    return undefined
  } finally {
    db.close()
  }
}

export async function writeBrowserBuild(
  workspaceId: string,
  result: BrowserBuildResult,
) {
  if (!validResult(result)) throw new Error('Invalid browser build result')
  // Hash and store the caller's buffers. IndexedDB structured-clones them, so a
  // second JavaScript copy here doubled peak renderer memory for PROS packages.
  const artifacts = await Promise.all(
    result.artifacts.map(async ({ path, bytes }) => ({
      path,
      bytes,
      digest: await buildCacheKey([bytes]),
      size: bytes.byteLength,
    })),
  )
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['builds', 'blobs'], 'readwrite')
      const builds = transaction.objectStore('builds')
      const blobs = transaction.objectStore('blobs')
      for (const artifact of artifacts) {
        // Repair corrupt persisted bytes with the newly verified owned bytes.
        blobs.put(
          { bytes: artifact.bytes, size: artifact.size },
          artifact.digest,
        )
      }
      const record: StoredBuild = {
        version: 1,
        storedAt: Date.now(),
        commitSha: result.commitSha,
        exitCode: result.exitCode,
        output: result.output,
        artifacts: artifacts.map(({ path, digest, size }) => ({
          path,
          digest,
          size,
        })),
      }
      builds.put(record, workspaceId)
      // Cursor bounds storage without materializing every binary in JavaScript.
      const records: Array<{ key: IDBValidKey; value: StoredBuild | null }> = []
      const cursor = builds.openCursor()
      cursor.onsuccess = () => {
        const entry = cursor.result
        if (entry) {
          records.push({ key: entry.key, value: entry.value })
          entry.continue()
          return
        }
        records.sort(
          (a, b) => (b.value?.storedAt ?? 0) - (a.value?.storedAt ?? 0),
        )
        const referenced = new Set<string>()
        let total = 0
        for (let index = 0; index < records.length; index++) {
          const { key, value } = records[index]
          const refs: Array<ArtifactReference | null> =
            value?.version === 1 && Array.isArray(value.artifacts)
              ? value.artifacts
              : []
          let buildSize = 0
          const valid = refs.every((artifact) => {
            if (
              !artifact ||
              !/^[a-f0-9]{64}$/.test(artifact.digest) ||
              !Number.isSafeInteger(artifact.size) ||
              artifact.size < 0 ||
              artifact.size > artifactLimit
            )
              return false
            buildSize += artifact.size
            return buildSize <= buildArtifactLimit
          })
          const size = (valid ? refs : []).reduce(
            (sum, artifact) =>
              sum + (referenced.has(artifact!.digest) ? 0 : artifact!.size),
            0,
          )
          if (
            index >= buildLimit ||
            total + size > byteLimit ||
            value?.version !== 1 ||
            !valid
          ) {
            builds.delete(key)
          } else {
            total += size
            refs.forEach((artifact) => referenced.add(artifact!.digest))
          }
        }
        const blobCursor = blobs.openCursor()
        blobCursor.onsuccess = () => {
          const blob = blobCursor.result
          if (!blob) return
          if (!referenced.has(String(blob.key))) blob.delete()
          blob.continue()
        }
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export async function deleteBrowserBuild(workspaceId: string): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['builds', 'blobs'], 'readwrite')
      const builds = transaction.objectStore('builds')
      const blobs = transaction.objectStore('blobs')
      const referenced = new Set<string>()
      builds.delete(workspaceId)

      const buildCursor = builds.openCursor()
      buildCursor.onsuccess = () => {
        const cursor = buildCursor.result
        if (cursor) {
          const value: unknown = cursor.value
          if (
            value &&
            typeof value === 'object' &&
            'version' in value &&
            value.version === 1 &&
            'artifacts' in value &&
            Array.isArray(value.artifacts)
          ) {
            for (const artifact of value.artifacts) {
              if (
                artifact &&
                typeof artifact === 'object' &&
                'digest' in artifact &&
                typeof artifact.digest === 'string' &&
                /^[a-f0-9]{64}$/.test(artifact.digest)
              )
                referenced.add(artifact.digest)
            }
          }
          cursor.continue()
          return
        }

        const blobCursor = blobs.openCursor()
        blobCursor.onsuccess = () => {
          const blob = blobCursor.result
          if (!blob) return
          if (!referenced.has(String(blob.key))) blob.delete()
          blob.continue()
        }
      }

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}
