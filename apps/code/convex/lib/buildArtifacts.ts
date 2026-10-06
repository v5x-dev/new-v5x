export const BUILD_OUTPUTS_MARKER = '\n__V5X_BUILD_OUTPUTS__\n'
const OUTPUTS_END = '__V5X_BUILD_OUTPUTS_END__'

// Include small binaries in the exec response to avoid another cloud request.
// Larger artifacts retain the binary file API; never truncate their bytes.
export const collectBuildOutputs = [
  "printf '\\n__V5X_BUILD_OUTPUTS__\\n'",
  'remaining=262144',
  "find ./build ./bin -type f -name '*.bin' 2>/dev/null | head -100 | while IFS= read -r path; do",
  '  hash="$(sha256sum "$path")"',
  '  hash="${hash%% *}"',
  '  size="$(wc -c < "$path")"',
  '  printf "%s\\t%s\\t%s\\t" "$path" "$hash" "$size"',
  '  if [ "$size" -le "$remaining" ]; then',
  '    base64 "$path" | tr -d "\\n"',
  '    remaining=$((remaining - size))',
  '  fi',
  "  printf '\\n'",
  'done',
  `printf '${OUTPUTS_END}\\n'`,
].join('\n')

export function parseBuildOutputs(stdout: string) {
  const start = stdout.lastIndexOf(BUILD_OUTPUTS_MARKER)
  if (start < 0 || !stdout.slice(start).trimEnd().endsWith(OUTPUTS_END)) {
    throw new Error('Missing or truncated build artifact manifest')
  }
  const files = stdout
    .slice(start + BUILD_OUTPUTS_MARKER.length)
    .trimEnd()
    .split(/\r?\n/)
  files.pop()
  const outputs = files.filter(Boolean).map((line) => {
    const [rawPath, sha256, rawSize, base64 = ''] = line.split('\t')
    if (
      !/^\.\/(build|bin)\/.+\.bin$/.test(rawPath) ||
      rawPath
        .split('/')
        .some(
          (part, index) =>
            index > 0 && (!part || part === '.' || part === '..'),
        ) ||
      !/^[0-9a-f]{64}$/.test(sha256) ||
      !/^\d+$/.test(rawSize) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        base64,
      )
    )
      throw new Error('Invalid build artifact manifest')
    const size = Number(rawSize)
    if (!Number.isSafeInteger(size)) throw new Error('Invalid artifact size')
    return { path: rawPath.slice(2), sha256, size, base64 }
  })
  if (new Set(outputs.map(({ path }) => path)).size !== outputs.length)
    throw new Error('Duplicate build artifact')
  return { stdout: stdout.slice(0, start), outputs }
}
