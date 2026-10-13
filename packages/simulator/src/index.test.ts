import { expect, test } from "bun:test"
import {
  decodeSimulatorProgram,
  encodeProsPackage,
  validSimulatorManifest,
} from "./index"

test("PROS packages preserve both owned binaries and reject truncation and oversized hot code", () => {
  const cold = new Uint8Array([1, 2, 3])
  const hot = new Uint8Array([4, 5])
  const bytes = encodeProsPackage(cold, hot)
  cold[0] = 9
  const decoded = decodeSimulatorProgram(bytes)
  expect(decoded.cold).toEqual(new Uint8Array([1, 2, 3]))
  expect(decoded.hot).toEqual(hot)
  expect(() =>
    decodeSimulatorProgram(bytes.subarray(0, bytes.length - 1))
  ).toThrow("sizes")
  expect(() =>
    encodeProsPackage(cold, new Uint8Array(8 * 1024 * 1024 + 1))
  ).toThrow("sizes")
  expect(decodeSimulatorProgram(hot)).toEqual({ cold: hot, hot: undefined })
})

test("manifests require matching template, format and artifact path and exclude JAR", () => {
  const manifest = {
    version: 1,
    format: "pros-v5-package",
    template: "pros",
    commitSha: "commit",
    sourceSha256: "a".repeat(64),
    artifact: { path: "build/simulator.v5x", size: 40, sha256: "b".repeat(64) },
  }
  expect(validSimulatorManifest(manifest)).toBe(true)
  expect(validSimulatorManifest({ ...manifest, template: "ez-template" })).toBe(
    true
  )
  expect(
    validSimulatorManifest({ ...manifest, template: "jar-template" })
  ).toBe(false)
  expect(validSimulatorManifest({ ...manifest, template: "vexcode" })).toBe(
    false
  )
  expect(validSimulatorManifest({ ...manifest, artifact: null })).toBe(false)
})
