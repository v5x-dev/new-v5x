import { expect, test } from "bun:test"
import { Euler, Quaternion, Vector3 } from "three"
import { alignHoles, HOLES, MODEL_SCALE } from "./holes"
import type { AssemblyPart } from "./assembly"

test("the 35-hole angle uses inch units, half-inch pitch, and unit face normals", () => {
  const holes =
    HOLES["/models/vex-v5rc-parts/angles/aluminum/1x1x35-aluminum-angle.glb"]
  expect(0.0254 * MODEL_SCALE).toBeCloseTo(1)
  expect(holes).toHaveLength(140)
  expect(holes[34].center[0] - holes[0].center[0]).toBe(17)
  expect(holes[1].center[0] - holes[0].center[0]).toBe(0.5)
  for (const hole of holes) expect(new Vector3(...hole.axis).length()).toBe(1)
})

test("hole alignment works after both parts have been rotated and translated", () => {
  const hole = Object.values(HOLES)[0][10]
  const moving: AssemblyPart = {
    id: "moving",
    path: "",
    position: [2, 5, -3],
    rotation: [0.7, 0.3, 1.2],
  }
  const fixed: AssemblyPart = {
    id: "fixed",
    path: "",
    position: [3, -1, 4],
    rotation: [0.2, 1, 0.4],
  }
  const aligned = alignHoles(moving, hole, fixed, hole)
  const q = new Quaternion().setFromEuler(new Euler(...aligned.rotation))
  const fixedQ = new Quaternion().setFromEuler(new Euler(...fixed.rotation))
  const center = new Vector3(...hole.center)
    .applyQuaternion(q)
    .add(new Vector3(...aligned.position))
  const fixedCenter = new Vector3(...hole.center)
    .applyQuaternion(fixedQ)
    .add(new Vector3(...fixed.position))
  expect(center.distanceTo(fixedCenter)).toBeLessThan(1e-10)
  const axis = new Vector3(...hole.axis).applyQuaternion(q)
  const fixedAxis = new Vector3(...hole.axis).applyQuaternion(fixedQ)
  expect(axis.dot(fixedAxis)).toBeCloseTo(-1)
})
