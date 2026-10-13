import { Euler, Quaternion, Vector3 } from "three"
import type { AssemblyPart, Coordinates } from "./assembly"

export interface Hole {
  center: Coordinates
  axis: Coordinates
  type: "square"
}

export const MODEL_SCALE = 1 / 0.0254
export const HOLES: Record<string, Hole[]> = {
  "/models/vex-v5rc-parts/angles/aluminum/1x1x35-aluminum-angle.glb": [
    ...Array.from({ length: 35 }, (_, index): Hole => ({
      center: [index / 2 - 8.5, 0.045, -0.218],
      axis: [0, 0, 1],
      type: "square",
    })),
    ...Array.from({ length: 35 }, (_, index): Hole => ({
      center: [index / 2 - 8.5, -0.218, 0.045],
      axis: [0, 1, 0],
      type: "square",
    })),
  ],
}

// Align the moving hole center and opposing face normal with the fixed hole.
export function alignHoles(
  moving: AssemblyPart,
  movingHole: Hole,
  fixed: AssemblyPart,
  fixedHole: Hole,
) {
  const movingRotation = new Quaternion().setFromEuler(
    new Euler(...moving.rotation),
  )
  const fixedRotation = new Quaternion().setFromEuler(
    new Euler(...fixed.rotation),
  )
  const from = new Vector3(...movingHole.axis)
    .applyQuaternion(movingRotation)
    .normalize()
  const to = new Vector3(...fixedHole.axis)
    .applyQuaternion(fixedRotation)
    .normalize()
    .negate()
  if (!from.lengthSq() || !to.lengthSq())
    throw new Error("Hole normal must be nonzero")
  movingRotation.premultiply(new Quaternion().setFromUnitVectors(from, to))
  const target = new Vector3(...fixedHole.center)
    .applyQuaternion(fixedRotation)
    .add(new Vector3(...fixed.position))
  const offset = new Vector3(...movingHole.center).applyQuaternion(
    movingRotation,
  )
  const rotation = new Euler().setFromQuaternion(movingRotation)
  return {
    position: target.sub(offset).toArray() as Coordinates,
    rotation: [rotation.x, rotation.y, rotation.z] as Coordinates,
  }
}
