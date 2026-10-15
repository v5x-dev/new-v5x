export const maximumMessageBytes = 8 * 1024 * 1024

export function send(
  socket: { send(text: string): void; getBufferedAmount(): number },
  message: unknown
) {
  const text = JSON.stringify(message)
  if (Buffer.byteLength(text) > maximumMessageBytes)
    throw new Error("Language server response exceeded the 8 MB limit")
  if (socket.getBufferedAmount() > maximumMessageBytes)
    throw new Error("Language server client is not keeping up")
  socket.send(text)
}

export async function writeFrame(
  child: ReturnType<typeof Bun.spawn>,
  json: string
) {
  const body = Buffer.from(json)
  const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`)
  const stdin = child.stdin
  if (!stdin || typeof stdin === "number")
    throw new Error("Native clangd stdin pipe is unavailable")
  stdin.write(Buffer.concat([header, body]))
  await stdin.flush()
}

export class LspFrameParser {
  private buffer = new Uint8Array()

  push(chunk: Uint8Array) {
    if (this.buffer.byteLength + chunk.byteLength > maximumMessageBytes + 8192)
      throw new Error("Clangd response exceeded the 8 MB language limit")
    const joined = new Uint8Array(this.buffer.byteLength + chunk.byteLength)
    joined.set(this.buffer)
    joined.set(chunk, this.buffer.byteLength)
    this.buffer = joined

    const messages: Array<unknown> = []
    while (true) {
      const headerEnd = findHeaderEnd(this.buffer)
      if (headerEnd < 0) {
        if (this.buffer.byteLength > 8192)
          throw new Error("Invalid clangd message header")
        break
      }
      const header = new TextDecoder().decode(
        this.buffer.subarray(0, headerEnd)
      )
      const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header)
      const length = match ? Number(match[1]) : NaN
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > maximumMessageBytes
      )
        throw new Error("Invalid clangd message length")
      const bodyStart = headerEnd + 4
      if (this.buffer.byteLength - bodyStart < length) break
      const body = this.buffer.subarray(bodyStart, bodyStart + length)
      try {
        messages.push(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))
        )
      } catch {
        throw new Error("Clangd response could not be read")
      }
      this.buffer = this.buffer.slice(bodyStart + length)
    }
    return messages
  }
}

export function findHeaderEnd(bytes: Uint8Array) {
  for (let index = 3; index < bytes.length; index++)
    if (
      bytes[index - 3] === 13 &&
      bytes[index - 2] === 10 &&
      bytes[index - 1] === 13 &&
      bytes[index] === 10
    )
      return index - 3
  return -1
}
