export function encodeBase64(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  }
  return btoa(binary)
}

export function decodeBase64(encoded: string) {
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
}

export async function sha256(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', copy.buffer),
  )
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
