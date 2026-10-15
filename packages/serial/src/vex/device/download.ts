export interface DownloadFileOptions {
  maxBytes?: number
  timeoutMs?: number
}

export async function downloadFileFromInternet(
  link: string,
  options: DownloadFileOptions = {}
): Promise<ArrayBuffer> {
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY
  const timeoutMs = options.timeoutMs ?? 30000

  if (
    (maxBytes !== Number.POSITIVE_INFINITY &&
      (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > 0x7fffffff
  ) {
    throw new RangeError("Invalid download limits")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(link, { signal: controller.signal })

    if (!response.ok) {
      throw new Error(`Download failed ${response.status} ${link}`)
    }

    const declaredLength = Number(response.headers.get("content-length"))

    if (Number.isSafeInteger(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`Download exceeds the ${maxBytes}-byte limit`)
    }

    if (response.body == null) {
      const body = await response.arrayBuffer()

      if (body.byteLength > maxBytes) {
        throw new Error(`Download exceeds the ${maxBytes}-byte limit`)
      }

      return body
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0

    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value === undefined) continue
        total += value.byteLength

        if (total > maxBytes) {
          throw new Error(`Download exceeds the ${maxBytes}-byte limit`)
        }

        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }

    const body = new Uint8Array(total)
    let offset = 0

    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }

    return body.buffer
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}
