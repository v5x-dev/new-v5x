import { validPath } from './workspace-path'
import type { BrowserBuildInput, BrowserBuildResult } from './browser-build'

export const compilationProtocol = 'v5x-compile-v1'
export const maximumSourceBytes = 6 * 1024 * 1024
export const maximumArtifactBytes = 64 * 1024 * 1024

export function compilationServerUrl(value: string) {
  const url = new URL(value)
  if (
    !['ws:', 'wss:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('Enter a ws:// or wss:// compilation server URL.')
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
    } catch (error) {
      reject(error)
      return
    }
    let settled = false
    let connected = false
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
            }),
          )
        } else if (
          message.type === 'output' &&
          connected &&
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
          const result = message.result
          if (
            result?.commitSha !== input.commitSha ||
            !Number.isInteger(result.exitCode) ||
            typeof result.output !== 'string' ||
            !Array.isArray(result.artifacts) ||
            result.artifacts.length > 100
          )
            throw new Error('Invalid remote build result')
          let bytes = 0
          const paths = new Set<string>()
          const artifacts = result.artifacts.map(
            (artifact: { path: string; base64: string }) => {
              if (
                typeof artifact.path !== 'string' ||
                !validPath(artifact.path) ||
                paths.has(artifact.path) ||
                typeof artifact.base64 !== 'string'
              )
                throw new Error('Invalid remote build artifact')
              paths.add(artifact.path)
              const decoded = atob(artifact.base64)
              bytes += decoded.length
              if (bytes > maximumArtifactBytes)
                throw new Error('Remote build artifacts exceed 64 MB')
              return {
                path: artifact.path,
                bytes: Uint8Array.from(decoded, (char) => char.charCodeAt(0)),
              }
            },
          )
          finish(undefined, {
            commitSha: result.commitSha,
            exitCode: result.exitCode,
            output: result.output,
            artifacts,
          })
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
