import { validPath } from './workspace-path'
import type { BrowserBuildInput, BrowserBuildResult } from './browser-build'

export const compilationProtocol = 'v5x-compile-v1'
export const maximumSourceBytes = 6 * 1024 * 1024
export const maximumArtifactBytes = 64 * 1024 * 1024

export function compilationServerUrl(value: string, token = '') {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Enter the compilation server or tunnel URL.')
  }
  if (url.protocol === 'https:') url.protocol = 'wss:'
  if (url.protocol === 'http:') url.protocol = 'ws:'
  if (
    !['ws:', 'wss:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('Enter an http://, https://, ws://, or wss:// server URL.')
  if (url.pathname === '/') url.pathname = '/compile'
  const accessToken = (url.searchParams.get('token') || token).trim()
  if (accessToken.length < 16)
    throw new Error('Enter the access token printed by the compilation server.')
  url.searchParams.set('token', accessToken)
  return url.href
}

export function validateRemoteInput(value: unknown): BrowserBuildInput {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid build request')
  const input = value as BrowserBuildInput
  if (
    !['vexcode', 'pros', 'ez-template', 'jar-template'].includes(
      input.template,
    ) ||
    typeof input.commitSha !== 'string' ||
    input.commitSha.length > 128 ||
    (input.workspaceId !== undefined &&
      (typeof input.workspaceId !== 'string' ||
        input.workspaceId.length > 256)) ||
    !input.files ||
    typeof input.files !== 'object' ||
    Array.isArray(input.files)
  )
    throw new Error('Invalid build request')
  const files = Object.entries(input.files)
  if (files.length > 2000) throw new Error('Too many source files')
  let bytes = 0
  for (const [path, contents] of files) {
    if (!validPath(path) || path.length > 4096 || typeof contents !== 'string')
      throw new Error('Invalid source file')
    bytes += new TextEncoder().encode(path + contents).byteLength
    if (bytes > maximumSourceBytes)
      throw new Error('Project exceeds the 6 MB source limit')
  }
  // Remote clients cannot select experimental compiler internals or preload jobs.
  return {
    files: input.files,
    template: input.template,
    commitSha: input.commitSha,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  }
}

interface RemoteResultMetadata {
  commitSha: string
  exitCode: number
  output: string
}

interface BinaryArtifactDescriptor {
  path: string
  byteLength: number
}

interface BinaryResultTransfer {
  metadata: RemoteResultMetadata
  descriptors: Array<BinaryArtifactDescriptor>
  artifacts: BrowserBuildResult['artifacts']
  artifactIndex: number
  offset: number
}

const maximumArtifactChunkBytes = 256 * 1024
const artifactFrameHeaderBytes = 8

function validResultMetadata(
  value: unknown,
  commitSha: string,
): value is RemoteResultMetadata {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<RemoteResultMetadata>
  return (
    result.commitSha === commitSha &&
    Number.isInteger(result.exitCode) &&
    typeof result.output === 'string'
  )
}

function prepareBinaryResult(
  message: Record<string, unknown>,
  commitSha: string,
): BinaryResultTransfer {
  if (
    !validResultMetadata(message.result, commitSha) ||
    !Array.isArray(message.artifacts) ||
    message.artifacts.length > 100
  )
    throw new Error('Invalid remote build result')

  const descriptors: Array<BinaryArtifactDescriptor> = []
  const paths = new Set<string>()
  let totalBytes = 0
  for (const value of message.artifacts) {
    if (!value || typeof value !== 'object')
      throw new Error('Invalid remote build artifact')
    const artifact = value as Partial<BinaryArtifactDescriptor>
    if (
      typeof artifact.path !== 'string' ||
      artifact.path.length > 4096 ||
      !validPath(artifact.path) ||
      paths.has(artifact.path) ||
      !Number.isSafeInteger(artifact.byteLength) ||
      (artifact.byteLength as number) < 0
    )
      throw new Error('Invalid remote build artifact')

    paths.add(artifact.path)
    totalBytes += artifact.byteLength as number
    if (totalBytes > maximumArtifactBytes)
      throw new Error('Remote build artifacts exceed 64 MB')
    descriptors.push({
      path: artifact.path,
      byteLength: artifact.byteLength as number,
    })
  }

  // Validate every descriptor before allocating the final result buffers.
  const artifacts = descriptors.map(({ path, byteLength }) => ({
    path,
    bytes: new Uint8Array(byteLength),
  }))
  const transfer: BinaryResultTransfer = {
    metadata: message.result,
    descriptors,
    artifacts,
    artifactIndex: 0,
    offset: 0,
  }
  advanceEmptyArtifacts(transfer)
  return transfer
}

function advanceEmptyArtifacts(transfer: BinaryResultTransfer) {
  while (
    transfer.artifactIndex < transfer.descriptors.length &&
    transfer.descriptors[transfer.artifactIndex]!.byteLength === 0
  ) {
    transfer.artifactIndex++
    transfer.offset = 0
  }
}

function receiveArtifactFrame(
  transfer: BinaryResultTransfer,
  frame: ArrayBuffer,
) {
  if (frame.byteLength <= artifactFrameHeaderBytes)
    throw new Error('Invalid remote build artifact frame')

  const view = new DataView(frame)
  const artifactIndex = view.getUint32(0, true)
  const offset = view.getUint32(4, true)
  const descriptor = transfer.descriptors[transfer.artifactIndex]
  const artifact = transfer.artifacts[transfer.artifactIndex]
  const chunkLength = frame.byteLength - artifactFrameHeaderBytes
  if (
    !descriptor ||
    !artifact ||
    artifactIndex !== transfer.artifactIndex ||
    offset !== transfer.offset ||
    chunkLength > maximumArtifactChunkBytes ||
    chunkLength > descriptor.byteLength - transfer.offset
  )
    throw new Error('Invalid or out-of-order remote build artifact frame')

  // The WebSocket owns this frame. Copy directly into the final result buffer.
  artifact.bytes.set(
    new Uint8Array(frame, artifactFrameHeaderBytes, chunkLength),
    transfer.offset,
  )
  transfer.offset += chunkLength
  const acknowledgedOffset = transfer.offset
  if (transfer.offset === descriptor.byteLength) {
    transfer.artifactIndex++
    transfer.offset = 0
    advanceEmptyArtifacts(transfer)
  }

  return { index: artifactIndex, offset: acknowledgedOffset }
}

function completeBinaryResult(
  transfer: BinaryResultTransfer,
): BrowserBuildResult {
  if (
    transfer.artifactIndex !== transfer.descriptors.length ||
    transfer.offset !== 0
  )
    throw new Error('Remote build artifact stream was truncated')

  return { ...transfer.metadata, artifacts: transfer.artifacts }
}

function legacyDecodedLength(value: string) {
  const length = value.length
  if (length % 4 !== 0)
    throw new Error('Invalid remote build artifact encoding')

  if (length === 0) return 0
  let padding = 0
  if (value.charCodeAt(length - 1) === 61) padding++
  if (padding === 1 && value.charCodeAt(length - 2) === 61) padding++
  const dataLength = length - padding

  for (let index = 0; index < dataLength; index++) {
    const code = value.charCodeAt(index)
    const valid =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47
    if (!valid) throw new Error('Invalid remote build artifact encoding')
  }
  for (let index = dataLength; index < length; index++) {
    if (value.charCodeAt(index) !== 61)
      throw new Error('Invalid remote build artifact encoding')
  }

  if (
    (padding === 1 && dataLength % 4 !== 3) ||
    (padding === 2 && dataLength % 4 !== 2) ||
    padding > 2
  )
    throw new Error('Invalid remote build artifact encoding')

  return (length / 4) * 3 - padding
}

function decodeLegacyArtifact(value: string, expectedLength: number) {
  const decoded = atob(value)
  if (decoded.length !== expectedLength)
    throw new Error('Invalid remote build artifact encoding')

  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index++)
    bytes[index] = decoded.charCodeAt(index)
  return bytes
}

function decodeLegacyResult(
  value: unknown,
  commitSha: string,
): BrowserBuildResult {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid remote build result')
  const result = value as Record<string, unknown>
  if (
    !validResultMetadata(result, commitSha) ||
    !Array.isArray(result.artifacts) ||
    result.artifacts.length > 100
  )
    throw new Error('Invalid remote build result')

  const legacyArtifacts = result.artifacts as Array<{
    path?: unknown
    base64?: unknown
  }>
  const paths = new Set<string>()
  let encodedBytes = 0
  let totalBytes = 0
  const descriptors = legacyArtifacts.map((artifact) => {
    if (
      !artifact ||
      typeof artifact.path !== 'string' ||
      artifact.path.length > 4096 ||
      !validPath(artifact.path) ||
      paths.has(artifact.path) ||
      typeof artifact.base64 !== 'string'
    )
      throw new Error('Invalid remote build artifact')
    paths.add(artifact.path)

    encodedBytes += artifact.base64.length
    if (encodedBytes > Math.ceil(maximumArtifactBytes / 3) * 4 + 400)
      throw new Error('Remote build artifacts exceed 64 MB')

    const byteLength = legacyDecodedLength(artifact.base64)
    totalBytes += byteLength
    if (totalBytes > maximumArtifactBytes)
      throw new Error('Remote build artifacts exceed 64 MB')
    return { path: artifact.path, base64: artifact.base64, byteLength }
  })

  return {
    commitSha: result.commitSha as string,
    exitCode: result.exitCode as number,
    output: result.output as string,
    artifacts: descriptors.map(({ path, base64, byteLength }) => ({
      path,
      bytes: decodeLegacyArtifact(base64, byteLength),
    })),
  }
}

function remoteRequest(
  endpoint: string,
  input: BrowserBuildInput | null,
  report: (text: string) => void,
  signal?: AbortSignal,
): Promise<BrowserBuildResult | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Build cancelled'))
      return
    }
    let socket: WebSocket
    try {
      socket = new WebSocket(
        compilationServerUrl(endpoint),
        compilationProtocol,
      )
      socket.binaryType = 'arraybuffer'
    } catch (error) {
      reject(error)
      return
    }
    let settled = false
    let connected = false
    let binaryTransfer: BinaryResultTransfer | undefined
    let timer: ReturnType<typeof setTimeout>
    const finish = (
      error?: Error,
      result: BrowserBuildResult | null = null,
    ) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      socket.close()
      if (error) reject(error)
      else resolve(result)
    }
    const cancel = () => finish(new Error('Build cancelled'))
    timer = setTimeout(
      () => finish(new Error('Compilation server connection timed out')),
      10_000,
    )
    signal?.addEventListener('abort', cancel, { once: true })
    socket.onerror = () =>
      finish(
        new Error(
          'Could not connect to the compilation server. Check the URL, token, and TLS settings.',
        ),
      )
    socket.onclose = () =>
      finish(new Error('Compilation server disconnected before finishing'))
    socket.onmessage = ({ data }) => {
      try {
        if (data instanceof ArrayBuffer) {
          if (!connected || !input || !binaryTransfer)
            throw new Error('Unexpected compilation server binary frame')
          const acknowledgement = receiveArtifactFrame(binaryTransfer, data)
          socket.send(
            JSON.stringify({ type: 'artifact-ack', ...acknowledgement }),
          )
          return
        }
        if (
          typeof data !== 'string' ||
          data.length > maximumArtifactBytes * 1.4
        )
          throw new Error('Invalid compilation server response')
        const message = JSON.parse(data)
        if (message.type === 'ready' && !connected) {
          if (message.protocol !== compilationProtocol)
            throw new Error('Compilation server protocol mismatch')
          connected = true
          clearTimeout(timer)
          if (!input) {
            finish()
            return
          }
          timer = setTimeout(
            () => finish(new Error('Remote build exceeded ten minutes')),
            10 * 60_000,
          )
          socket.send(
            JSON.stringify({
              type: 'build',
              input: validateRemoteInput(input),
              artifactEncoding: 'binary-v1',
            }),
          )
        } else if (
          message.type === 'output' &&
          connected &&
          !binaryTransfer &&
          typeof message.text === 'string'
        ) {
          report(message.text)
        } else if (message.type === 'error') {
          throw new Error(
            typeof message.message === 'string'
              ? message.message
              : 'Remote build failed',
          )
        } else if (message.type === 'result' && connected && input) {
          if (binaryTransfer)
            throw new Error('Unexpected legacy result during binary transfer')
          finish(undefined, decodeLegacyResult(message.result, input.commitSha))
        } else if (
          message.type === 'result-start' &&
          connected &&
          input &&
          !binaryTransfer
        ) {
          binaryTransfer = prepareBinaryResult(message, input.commitSha)
        } else if (
          message.type === 'result-end' &&
          connected &&
          input &&
          binaryTransfer
        ) {
          finish(undefined, completeBinaryResult(binaryTransfer))
        } else throw new Error('Unexpected compilation server response')
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
  })
}

export async function buildOnServer(
  endpoint: string,
  input: BrowserBuildInput,
  report: (text: string) => void,
  signal?: AbortSignal,
) {
  return (await remoteRequest(endpoint, input, report, signal))!
}

export async function testCompilationServer(
  endpoint: string,
  signal?: AbortSignal,
) {
  await remoteRequest(endpoint, null, () => {}, signal)
}
