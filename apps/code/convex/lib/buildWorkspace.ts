import { encodeBase64 } from './buildBytes'

// Fetch a known Git commit without the discovery round trip used by git fetch.
// Keep real commit objects and checkout semantics, including modes and deletions.
// Bound action memory and Linux's total command size. Split the payload below
// to stay beneath the per-argument limit as well. Larger packs use git fetch.
const MAX_PACK_BYTES = 1024 * 1024

function packet(line: string) {
  return (
    (new TextEncoder().encode(line).length + 4).toString(16).padStart(4, '0') +
    line
  )
}

export function parseSourcePack(bytes: Uint8Array) {
  const decoder = new TextDecoder()
  const shallow: Array<string> = []
  let offset = 0
  while (offset + 4 <= bytes.length) {
    const header = decoder.decode(bytes.subarray(offset, offset + 4))
    if (header === 'PACK') {
      if (bytes.length - offset < 32) throw new Error('Incomplete Git pack')
      return { pack: bytes.subarray(offset), shallow }
    }
    if (!/^[0-9a-f]{4}$/i.test(header)) throw new Error('Invalid Git packet')
    const length = parseInt(header, 16)
    if (length === 0) {
      offset += 4
      continue
    }
    if (length < 4 || offset + length > bytes.length)
      throw new Error('Incomplete Git packet')
    const line = decoder.decode(bytes.subarray(offset + 4, offset + length))
    const match = /^shallow ([0-9a-f]{40})\n?$/.exec(line)
    if (match) shallow.push(match[1])
    else if (
      !/^NAK\n?$/.test(line) &&
      !/^ACK [0-9a-f]{40}(?: (?:common|ready|continue))?\n?$/.test(line)
    ) {
      throw new Error('Unexpected Git response')
    }
    offset += length
  }
  throw new Error('Missing Git pack')
}

export async function fetchSourcePack(
  remoteUrl: string,
  commitSha: string,
  previousSha?: string,
) {
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error('Invalid commit')
  const url = new URL(remoteUrl)
  const headers: Record<string, string> = {
    'content-type': 'application/x-git-upload-pack-request',
    accept: 'application/x-git-upload-pack-result',
  }
  if (url.username || url.password) {
    headers.authorization =
      'Basic ' +
      encodeBase64(
        new TextEncoder().encode(
          `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
        ),
      )
    url.username = ''
    url.password = ''
  }
  url.pathname = url.pathname.replace(/\/$/, '') + '/git-upload-pack'
  const response = await fetch(url, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(15_000),
    body:
      packet(`want ${commitSha} ofs-delta\n`) +
      packet('deepen 1\n') +
      '0000' +
      (previousSha && /^[0-9a-f]{40}$/.test(previousSha)
        ? packet(`have ${previousSha}\n`)
        : '') +
      packet('done\n'),
  })
  if (!response.ok || !response.body)
    throw new Error(`Source pack unavailable (${response.status})`)
  const reader = response.body.getReader()
  const chunks: Array<Uint8Array> = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PACK_BYTES)
        throw new Error('Source pack exceeds fast sync limit')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  const { pack, shallow } = parseSourcePack(bytes)
  return {
    chunks: encodeBase64(pack).match(/.{1,32768}/g) ?? [],
    shallow: shallow.join('\n'),
  }
}

export const syncBuildWorkspace = [
  'set -eu',
  'remote_url="$1"',
  'commit_sha="$2"',
  'previous_sha="$3"',
  'pack="$4"',
  'shallow="$5"',
  '[ "$previous_sha" != - ] || previous_sha=""',
  '[ "$pack" != - ] || pack=""',
  '[ "$shallow" != - ] || shallow=""',
  'clear_credentials() { git -C /workspace remote set-url origin https://invalid.invalid/v5x-build-cache 2>/dev/null || true; }',
  'trap clear_credentials EXIT',
  'if [ -n "$pack" ]; then',
  '  mkdir -p /workspace',
  '  if [ ! -d /workspace/.git ]; then',
  '    git -C /workspace init -q',
  '    git -C /workspace remote add origin https://invalid.invalid/v5x-build-cache',
  '  fi',
  '  shift 5',
  '  for chunk in "$@"; do printf %s "$chunk"; done | base64 -d | git -C /workspace index-pack --stdin --fix-thin >/dev/null',
  '  if [ -n "$shallow" ]; then',
  '    printf "%s\\n" "$shallow" >> /workspace/.git/shallow',
  '    sort -u /workspace/.git/shallow > /workspace/.git/shallow.next',
  '    mv /workspace/.git/shallow.next /workspace/.git/shallow',
  '  fi',
  'elif [ -n "$previous_sha" ]; then',
  '  git -C /workspace remote set-url origin "$remote_url"',
  '  if [ "$previous_sha" != "$commit_sha" ]; then',
  '    git -C /workspace fetch --no-tags --depth=1 origin "$commit_sha"',
  '  fi',
  'else',
  '  git clone --no-checkout --depth=1 "$remote_url" /workspace',
  '  git -C /workspace cat-file -e "$commit_sha^{commit}" 2>/dev/null || git -C /workspace fetch --no-tags --depth=1 origin "$commit_sha"',
  'fi',
  'git -C /workspace checkout --force --detach "$commit_sha"',
].join('\n')
