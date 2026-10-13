export type SimulatorTemplate = "vexcode" | "pros" | "ez-template"

export interface SimulatorHandoffManifest {
  version: 1
  format: "vexcode-v5-raw" | "pros-v5-package"
  template: SimulatorTemplate
  commitSha: string
  sourceSha256: string
  artifact: {
    path: "build/workspace.bin" | "build/simulator.v5x"
    size: number
    sha256: string
  }
}

const magic = new TextEncoder().encode("V5XPROS1")
const headerSize = 16
export const maxSimulatorBytes = 32 * 1024 * 1024

export function simulatorTemplate(value: string): value is SimulatorTemplate {
  return ["vexcode", "pros", "ez-template"].includes(value)
}

export function encodeProsPackage(cold: Uint8Array, hot: Uint8Array) {
  if (
    !cold.length ||
    cold.length > 32 * 1024 * 1024 ||
    !hot.length ||
    hot.length > 8 * 1024 * 1024 ||
    headerSize + cold.length + hot.length > maxSimulatorBytes
  )
    throw new Error("Invalid PROS hot/cold package sizes")
  const bytes = new Uint8Array(headerSize + cold.length + hot.length)
  bytes.set(magic)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, cold.length, true)
  view.setUint32(12, hot.length, true)
  bytes.set(cold, headerSize)
  bytes.set(hot, headerSize + cold.length)
  return bytes
}

export function decodeSimulatorProgram(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > maxSimulatorBytes)
    throw new Error("Program must contain between 1 byte and 32 MiB")
  if (!magic.every((byte, index) => bytes[index] === byte))
    return { cold: bytes, hot: undefined }
  if (bytes.length < headerSize) throw new Error("Truncated PROS package")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const coldSize = view.getUint32(8, true)
  const hotSize = view.getUint32(12, true)
  if (
    !coldSize ||
    !hotSize ||
    hotSize > 8 * 1024 * 1024 ||
    headerSize + coldSize + hotSize !== bytes.length
  )
    throw new Error("Invalid PROS hot/cold package sizes")
  return {
    cold: bytes.subarray(headerSize, headerSize + coldSize),
    hot: bytes.subarray(headerSize + coldSize),
  }
}

export function validSimulatorManifest(
  value: unknown
): value is SimulatorHandoffManifest {
  if (!value || typeof value !== "object") return false
  const manifest = value as SimulatorHandoffManifest
  const hash = (entry: unknown) =>
    typeof entry === "string" && /^[a-f0-9]{64}$/.test(entry)
  return (
    manifest.version === 1 &&
    typeof manifest.template === "string" &&
    simulatorTemplate(manifest.template) &&
    (manifest.template === "vexcode"
      ? manifest.format === "vexcode-v5-raw" &&
        manifest.artifact?.path === "build/workspace.bin"
      : manifest.format === "pros-v5-package" &&
        manifest.artifact?.path === "build/simulator.v5x") &&
    typeof manifest.commitSha === "string" &&
    manifest.commitSha.length > 0 &&
    manifest.commitSha.length <= 128 &&
    hash(manifest.sourceSha256) &&
    !!manifest.artifact &&
    Number.isSafeInteger(manifest.artifact.size) &&
    manifest.artifact.size > 0 &&
    manifest.artifact.size <= maxSimulatorBytes &&
    hash(manifest.artifact.sha256)
  )
}
