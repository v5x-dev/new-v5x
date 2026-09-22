/** Same remote name PROS uses for cold.package.bin (md5 of template names). */
export function generateProsColdLibraryName(templateNames: string[]): string {
  const sorted = [...templateNames].sort(
    (a, b) => (a.charCodeAt(0) ?? 0) - (b.charCodeAt(0) ?? 0)
  )
  const msg = `[${sorted.map((name) => `'${name}'`).join(", ")}]`
  const digest = md5Bytes(new TextEncoder().encode(msg))
  return bytesToBase64(digest).replace(/=+$/, "")
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function md5Bytes(message: Uint8Array): Uint8Array {
  const originalLength = message.byteLength
  const bitLen = originalLength * 8
  const paddedLength = (((originalLength + 8) >> 6) + 1) << 6
  const padded = new Uint8Array(paddedLength)
  padded.set(message)
  padded[originalLength] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, bitLen >>> 0, true)
  view.setUint32(paddedLength - 4, Math.floor(bitLen / 0x100000000), true)

  let a = 0x67452301
  let b = 0xefcdab89
  let c = 0x98badcfe
  let d = 0x10325476

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
    9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
    16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
    15, 21,
  ]
  const k = new Uint32Array(64)
  for (let i = 0; i < 64; i++) {
    k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0
  }

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const m = new Uint32Array(16)
    for (let i = 0; i < 16; i++) {
      m[i] = view.getUint32(offset + i * 4, true)
    }
    let A = a
    let B = b
    let C = c
    let D = d
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        f = (D & B) | (~D & C)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = B ^ C ^ D
        g = (3 * i + 5) % 16
      } else {
        f = C ^ (B | ~D)
        g = (7 * i) % 16
      }
      const temp = D
      D = C
      C = B
      B = (B + rotl((A + f + k[i] + m[g]) >>> 0, s[i])) >>> 0
      A = temp
    }
    a = (a + A) >>> 0
    b = (b + B) >>> 0
    c = (c + C) >>> 0
    d = (d + D) >>> 0
  }

  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, a, true)
  outView.setUint32(4, b, true)
  outView.setUint32(8, c, true)
  outView.setUint32(12, d, true)
  return out
}

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}
