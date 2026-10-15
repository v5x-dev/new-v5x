import { USER_PROG_CHUNK_SIZE } from "../vex"

export function trimTrailingNuls(bytes: Uint8Array): Uint8Array {
  let end = bytes.byteLength
  while (end > 0 && bytes[end - 1] === 0) end--
  return end === bytes.byteLength ? bytes : bytes.slice(0, end)
}

export function transferChunkSize(windowSize: number): number {
  return windowSize > 0 && windowSize <= USER_PROG_CHUNK_SIZE
    ? windowSize
    : USER_PROG_CHUNK_SIZE
}

export function gzipBytes(data: Uint8Array): Promise<Uint8Array> {
  const bun = (
    globalThis as {
      Bun?: {
        gzipSync?: (d: Uint8Array) => Uint8Array
        spawnSync?: (opts: { cmd: string[]; stdin: Uint8Array }) => {
          success: boolean
          stdout: Uint8Array
        }
      }
    }
  ).Bun

  // Same payload as PROS compress_file: gzip.GzipFile(..., mtime=0)
  if (bun?.spawnSync !== undefined) {
    const proc = bun.spawnSync({
      cmd: [
        "python3",
        "-c",
        "import sys,gzip,io\nraw=sys.stdin.buffer.read()\nbuf=io.BytesIO()\nwith gzip.GzipFile(fileobj=buf,mode='wb',mtime=0) as f:\n    f.write(raw)\nsys.stdout.buffer.write(buf.getvalue())",
      ],
      stdin: data,
    })

    if (proc.success && proc.stdout.byteLength > 2) {
      return Promise.resolve(new Uint8Array(proc.stdout))
    }
  }

  const finish = (gzipped: Uint8Array): Uint8Array => {
    const out = new Uint8Array(gzipped)

    if (out.byteLength >= 8) {
      out[4] = 0
      out[5] = 0
      out[6] = 0
      out[7] = 0
    }

    return out
  }

  if (bun?.gzipSync !== undefined) {
    return Promise.resolve(finish(bun.gzipSync(data)))
  }

  if (typeof CompressionStream === "undefined") {
    return Promise.resolve(data)
  }

  const copy = new Uint8Array(data.byteLength)
  copy.set(data)

  const stream = new Blob([copy])
    .stream()
    .pipeThrough(new CompressionStream("gzip"))

  return new Response(stream)
    .arrayBuffer()
    .then((buffer) => finish(new Uint8Array(buffer)))
}
