import { Euler, Quaternion, Vector3 } from "three"
import type { AssemblyPart, Coordinates } from "./assembly"
import modelHoles from "./model-holes.json"

export interface Hole {
  center: Coordinates
  axis: Coordinates
  type: "square"
}

export const MODEL_SCALE = 1 / 0.0254
// Coordinates are extracted from square boundary loops on the GLB face meshes.
// Both sides of each sheet are retained so mates meet at actual surfaces.
export const HOLES: Record<string, Hole[]> = Object.fromEntries(
  Object.entries(modelHoles).map(([path, rows]) => [
    path,
    rows.map((row) => ({
      center: row.slice(0, 3) as Coordinates,
      axis: row.slice(3, 6) as Coordinates,
      type: "square" as const,
    })),
  ]),
)

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
