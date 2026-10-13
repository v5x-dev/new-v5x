import { expect, test } from "bun:test"
import {
  assemblyHistory,
  editAssembly,
  parseAssembly,
  partsList,
} from "./assembly"

const part = {
  id: "angle",
  path: "/angle.glb",
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
}

test("assembly edits undo and redo without modifying previous snapshots", () => {
  const initial = assemblyHistory()
  const added = editAssembly(initial, { type: "add", part })
  const moved = editAssembly(added, {
    type: "transform",
    id: part.id,
    position: [2, 3, 4],
    rotation: [0, 1, 0],
  })
  expect(initial.present.parts).toEqual([])
  expect(added.present.parts[0].position).toEqual([0, 0, 0])
  const undone = editAssembly(moved, { type: "undo" })
  expect(undone.present).toEqual(added.present)
  expect(editAssembly(undone, { type: "redo" }).present).toEqual(moved.present)
  expect(
    editAssembly(editAssembly(undone, { type: "remove", id: part.id }), {
      type: "redo",
    }).present.parts,
  ).toEqual([])
})

test("save/reload preserves transforms and duplicates count in the parts list", () => {
  const added = editAssembly(assemblyHistory(), { type: "add", part })
  const duplicated = editAssembly(added, {
    type: "duplicate",
    id: part.id,
    newId: "angle-2",
  })
  const restored = parseAssembly(
    JSON.stringify(duplicated.present),
    new Set([part.path]),
  )
  expect(restored).toEqual(duplicated.present)
  expect(partsList(restored)).toEqual([{ path: part.path, quantity: 2 }])
})

test("imports reject unknown assets, duplicate IDs, invalid units, and invalid transforms", () => {
  const document = editAssembly(assemblyHistory(), {
    type: "add",
    part,
  }).present
  expect(() => parseAssembly(JSON.stringify(document), new Set())).toThrow(
    "Invalid part",
  )
  expect(() =>
    parseAssembly(
      JSON.stringify({ ...document, units: "meters" }),
      new Set([part.path]),
    ),
  ).toThrow("Unsupported")
  expect(() =>
    parseAssembly(
      JSON.stringify({ ...document, parts: [part, part] }),
      new Set([part.path]),
    ),
  ).toThrow("Invalid part")
  expect(() =>
    editAssembly(assemblyHistory(document), {
      type: "transform",
      id: part.id,
      position: [Infinity, 0, 0],
      rotation: [0, 0, 0],
    }),
  ).toThrow("finite")
})

test("command inputs cannot mutate saved history after the command returns", () => {
  const input = {
    ...part,
    position: [...part.position] as [number, number, number],
    rotation: [...part.rotation] as [number, number, number],
  }
  const added = editAssembly(assemblyHistory(), { type: "add", part: input })
  input.position[0] = 50
  input.path = "/different.glb"
  expect(added.present.parts[0]).toEqual(part)
  const imported = {
    ...added.present,
    parts: added.present.parts.map((entry) => ({
      ...entry,
      position: [...entry.position] as [number, number, number],
    })),
  }
  const replaced = editAssembly(assemblyHistory(), {
    type: "replace",
    document: imported,
  })
  imported.parts[0].position[0] = 75
  expect(replaced.present.parts[0].position[0]).toBe(0)
  expect(() =>
    editAssembly(assemblyHistory(), {
      type: "add",
      part: { ...part, position: [NaN, 0, 0] },
    }),
  ).toThrow("Invalid part")
})

test("hole mates move either part as a rigid group and survive history and reload", () => {
  const path =
    "/models/vex-v5rc-parts/angles/aluminum/1x1x35-aluminum-angle.glb"
  let history = assemblyHistory()
  for (const id of ["fixed", "moving", "third"])
    history = editAssembly(history, {
      type: "add",
      part: { ...part, id, path },
    })
  history = editAssembly(history, {
    type: "mate",
    mate: { movingId: "moving", movingHole: 0, fixedId: "fixed", fixedHole: 0 },
  })
  history = editAssembly(history, {
    type: "mate",
    mate: { movingId: "third", movingHole: 1, fixedId: "moving", fixedHole: 1 },
  })
  const attached = history
  history = editAssembly(history, {
    type: "transform",
    id: "third",
    position: [5, 6, 7],
    rotation: [0.3, 0.8, 0.2],
  })
  const restored = parseAssembly(
    JSON.stringify(history.present),
    new Set([path]),
  )
  expect(restored).toEqual(history.present)
  expect(restored.parts[0].position).not.toEqual(
    attached.present.parts[0].position,
  )
  expect(editAssembly(history, { type: "undo" }).present).toEqual(
    attached.present,
  )
  expect(() =>
    editAssembly(history, {
      type: "mate",
      mate: {
        movingId: "fixed",
        movingHole: 2,
        fixedId: "third",
        fixedHole: 2,
      },
    }),
  ).toThrow("already connected")
  const detached = editAssembly(history, { type: "detach", movingId: "third" })
  const moved = editAssembly(detached, {
    type: "transform",
    id: "third",
    position: [10, 0, 0],
    rotation: [0, 0, 0],
  })
  expect(moved.present.parts[0]).toEqual(detached.present.parts[0])
  expect(
    editAssembly(history, { type: "remove", id: "moving" }).present.mates,
  ).toEqual([])
  const invalid = {
    ...history.present,
    mates: [
      { movingId: "third", movingHole: 10000, fixedId: "moving", fixedHole: 0 },
    ],
  }
  expect(() => parseAssembly(JSON.stringify(invalid), new Set([path]))).toThrow(
    "Invalid",
  )
})
