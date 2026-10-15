import type { BrowserBuildResult } from "@v5x/compiler/browser-build"
import { maximumArtifactBytes } from "@v5x/compiler/remote-build"
import { validPath } from "@v5x/compiler/workspace-path"

export const artifactChunkBytes = 256 * 1024
export const artifactWindowBytes = 1024 * 1024
export const artifactAckTimeoutMs = 30_000
const artifactFrameHeaderBytes = 8

interface ArtifactTransferSocket {
  send(data: string | Uint8Array): number | void
}

interface InFlightChunk {
  artifactIndex: number
  endOffset: number
  frameBytes: number
  timeout: ReturnType<typeof setTimeout>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function validateResult(result: BrowserBuildResult) {
  if (!Array.isArray(result.artifacts) || result.artifacts.length > 100)
    throw new Error("Remote build has too many artifacts")

  const paths = new Set<string>()
  let totalBytes = 0
  for (const artifact of result.artifacts) {
    if (
      !artifact ||
      typeof artifact.path !== "string" ||
      !validPath(artifact.path) ||
      artifact.path.length > 4096 ||
      paths.has(artifact.path) ||
      !(artifact.bytes instanceof Uint8Array)
    )
      throw new Error("Invalid remote build artifact")

    paths.add(artifact.path)
    totalBytes += artifact.bytes.byteLength
    if (totalBytes > maximumArtifactBytes)
      throw new Error("Remote build artifacts exceed 64 MB")
  }
}

/**
 * Streams a build result over a WebSocket with a byte-bounded ACK window.
 * Binary frames contain artifact index and offset as two little-endian uint32s,
 * followed by at most 256 KiB of artifact bytes.
 */
export class BinaryArtifactSender {
  private completion?: Promise<void>
  private resolveCompletion?: () => void
  private rejectCompletion?: (error: Error) => void
  private readonly inFlight = new Map<string, InFlightChunk>()
  private inFlightBytes = 0
  private artifactIndex = 0
  private offset = 0
  private pumping = false
  private settled = false

  constructor(
    private readonly socket: ArtifactTransferSocket,
    private readonly result: BrowserBuildResult,
    private readonly signal?: AbortSignal
  ) {}

  start(): Promise<void> {
    if (this.completion) return this.completion

    this.completion = new Promise<void>((resolve, reject) => {
      this.resolveCompletion = resolve
      this.rejectCompletion = reject
    })

    try {
      validateResult(this.result)
      if (this.signal?.aborted) {
        this.fail(new Error("Build cancelled"))
        return this.completion
      }
      this.signal?.addEventListener("abort", this.onAbort, { once: true })
      this.pump()
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    }

    return this.completion
  }

  /** Returns true only for an ACK matching one outstanding frame. */
  ack(message: unknown): boolean {
    if (!this.completion || this.settled || !isRecord(message)) return false

    const index = message.index
    const offset = message.offset
    if (
      message.type !== "artifact-ack" ||
      !Number.isInteger(index) ||
      !Number.isInteger(offset)
    ) {
      this.fail(new Error("Invalid artifact acknowledgement"))
      return false
    }

    const key = `${index}:${offset}`
    const chunk = this.inFlight.get(key)
    if (!chunk) {
      this.fail(new Error("Unexpected artifact acknowledgement"))
      return false
    }

    clearTimeout(chunk.timeout)
    this.inFlight.delete(key)
    this.inFlightBytes -= chunk.frameBytes
    this.pump()
    return true
  }

  private readonly onAbort = () => {
    this.fail(new Error("Build cancelled"))
  }

  private pump() {
    if (this.pumping || this.settled) return
    this.pumping = true

    try {
      while (this.artifactIndex < this.result.artifacts.length) {
        const artifact = this.result.artifacts[this.artifactIndex]!
        if (this.offset === artifact.bytes.byteLength) {
          this.artifactIndex++
          this.offset = 0
          continue
        }

        const available = artifactWindowBytes - this.inFlightBytes
        if (available <= artifactFrameHeaderBytes) break

        const chunkLength = Math.min(
          artifactChunkBytes,
          artifact.bytes.byteLength - this.offset,
          available - artifactFrameHeaderBytes
        )
        if (chunkLength <= 0) break

        const startOffset = this.offset
        const endOffset = startOffset + chunkLength
        const frame = new Uint8Array(artifactFrameHeaderBytes + chunkLength)
        const header = new DataView(
          frame.buffer,
          frame.byteOffset,
          artifactFrameHeaderBytes
        )
        header.setUint32(0, this.artifactIndex, true)
        header.setUint32(4, startOffset, true)
        frame.set(
          artifact.bytes.subarray(startOffset, endOffset),
          artifactFrameHeaderBytes
        )

        const key = `${this.artifactIndex}:${endOffset}`
        const timeout = setTimeout(() => {
          this.fail(
            new Error("Artifact transfer timed out waiting for acknowledgement")
          )
        }, artifactAckTimeoutMs)
        this.inFlight.set(key, {
          artifactIndex: this.artifactIndex,
          endOffset,
          frameBytes: frame.byteLength,
          timeout,
        })
        this.inFlightBytes += frame.byteLength

        const sent = this.socket.send(frame)
        if (typeof sent === "number" && sent < 0)
          throw new Error("Could not send build artifact")

        this.offset = endOffset
      }

      if (
        this.artifactIndex >= this.result.artifacts.length &&
        this.inFlight.size === 0
      )
        this.succeed()
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    } finally {
      this.pumping = false
    }
  }

  private succeed() {
    if (this.settled) return
    this.settled = true
    this.cleanup()
    this.resolveCompletion?.()
  }

  private fail(error: Error) {
    if (this.settled) return
    this.settled = true
    this.cleanup()
    this.rejectCompletion?.(error)
  }

  private cleanup() {
    this.signal?.removeEventListener("abort", this.onAbort)
    for (const chunk of this.inFlight.values()) clearTimeout(chunk.timeout)
    this.inFlight.clear()
    this.inFlightBytes = 0
  }
}
