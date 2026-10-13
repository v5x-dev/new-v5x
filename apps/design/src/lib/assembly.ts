import { Euler, Quaternion, Vector3 } from "three"
import { HOLES, alignHoles } from "./holes"

export type Coordinates = [number, number, number]

export interface AssemblyPart {
  id: string
  path: string
  position: Coordinates
  rotation: Coordinates
}

export interface HoleMate {
  movingId: string
  movingHole: number
  fixedId: string
  fixedHole: number
}

export interface AssemblyDocument {
  version: 1
  units: "inches"
  name: string
  parts: AssemblyPart[]
  mates?: HoleMate[]
}

export interface AssemblyHistory {
  past: AssemblyDocument[]
  present: AssemblyDocument
  future: AssemblyDocument[]
}

export type AssemblyCommand =
  | { type: "add"; part: AssemblyPart }
  | { type: "remove"; id: string }
  | { type: "duplicate"; id: string; newId: string }
  | {
      type: "transform"
      id: string
      position: Coordinates
      rotation: Coordinates
    }
  | { type: "mate"; mate: HoleMate }
  | { type: "detach"; movingId: string; fixedId?: string }
  | { type: "rename"; name: string }
  | { type: "replace"; document: AssemblyDocument }
  | { type: "undo" }
  | { type: "redo" }

export const emptyAssembly = (): AssemblyDocument => ({
  version: 1,
  units: "inches",
  name: "Untitled assembly",
  parts: [],
})

export function assemblyHistory(document = emptyAssembly()): AssemblyHistory {
  return { past: [], present: copyDocument(document), future: [] }
}

export function editAssembly(
  history: AssemblyHistory,
  command: AssemblyCommand,
): AssemblyHistory {
  if (command.type === "undo") {
    const previous = history.past.at(-1)
    return previous
      ? {
          past: history.past.slice(0, -1),
          present: previous,
          future: [history.present, ...history.future].slice(0, 100),
        }
      : history
  }
  if (command.type === "redo") {
    const next = history.future[0]
    return next
      ? {
          past: [...history.past, history.present].slice(-100),
          present: next,
          future: history.future.slice(1),
        }
      : history
  }

  const current = history.present
  let document: AssemblyDocument
  switch (command.type) {
    case "add":
      if (
        current.parts.some((part) => part.id === command.part.id) ||
        current.parts.length >= 2000
      )
        throw new Error("Part limit exceeded or duplicate part ID")
      document = {
        ...current,
        parts: [...current.parts, copyPart(command.part)],
      }
      break
    case "remove":
      document = {
        ...current,
        parts: current.parts.filter((part) => part.id !== command.id),
        mates: current.mates?.filter(
          (mate) => mate.movingId !== command.id && mate.fixedId !== command.id,
        ),
      }
      break
    case "duplicate": {
      const part = current.parts.find((part) => part.id === command.id)
      if (!part) return history
      return editAssembly(history, {
        type: "add",
        part: {
          ...part,
          id: command.newId,
          position: [
            part.position[0] + 0.5,
            part.position[1],
            part.position[2],
          ],
          rotation: [...part.rotation],
        },
      })
    }
    case "transform":
      if (!coordinates(command.position) || !coordinates(command.rotation))
        throw new Error("Transforms must contain finite coordinates")
      document = transformGroup(
        current,
        command.id,
        command.position,
        command.rotation,
      )
      break
    case "mate": {
      const mate = { ...command.mate }
      const moving = current.parts.find((part) => part.id === mate.movingId)
      const fixed = current.parts.find((part) => part.id === mate.fixedId)
      const movingHole = moving && HOLES[moving.path]?.[mate.movingHole]
      const fixedHole = fixed && HOLES[fixed.path]?.[mate.fixedHole]
      if (
        !moving ||
        !fixed ||
        !movingHole ||
        !fixedHole ||
        !Number.isInteger(mate.movingHole) ||
        !Number.isInteger(mate.fixedHole)
      )
        throw new Error("Select valid holes on two parts")
      if (connectedParts(current, moving.id).has(fixed.id))
        throw new Error(
          "These parts are already connected. Detach a mate first.",
        )
      const transform = alignHoles(moving, movingHole, fixed, fixedHole)
      document = transformGroup(
        current,
        moving.id,
        transform.position,
        transform.rotation,
      )
      document = { ...document, mates: [...(current.mates ?? []), mate] }
      break
    }
    case "detach":
      document = {
        ...current,
        mates: current.mates?.filter(
          (mate) =>
            mate.movingId !== command.movingId ||
            (command.fixedId !== undefined && mate.fixedId !== command.fixedId),
        ),
      }
      break
    case "rename":
      document = {
        ...current,
        name: command.name.trim().slice(0, 120) || "Untitled assembly",
      }
      break
    case "replace":
      document = copyDocument(command.document)
      break
  }
  if (JSON.stringify(document) === JSON.stringify(current)) return history
  return {
    past: [...history.past, current].slice(-100),
    present: document,
    future: [],
  }
}

function connectedParts(document: AssemblyDocument, id: string) {
  const adjacency = new Map<string, string[]>()
  for (const mate of document.mates ?? []) {
    for (const [from, to] of [
      [mate.movingId, mate.fixedId],
      [mate.fixedId, mate.movingId],
    ]) {
      const neighbors = adjacency.get(from) ?? []
      neighbors.push(to)
      adjacency.set(from, neighbors)
    }
  }
  const connected = new Set<string>()
  const pending = [id]
  while (pending.length) {
    const next = pending.pop()!
    if (connected.has(next)) continue
    connected.add(next)
    pending.push(...(adjacency.get(next) ?? []))
  }
  return connected
}

function transformGroup(
  document: AssemblyDocument,
  id: string,
  position: Coordinates,
  rotation: Coordinates,
): AssemblyDocument {
  const selected = document.parts.find((part) => part.id === id)
  if (!selected) return document
  const connected = connectedParts(document, id)
  const before = new Quaternion().setFromEuler(new Euler(...selected.rotation))
  const after = new Quaternion().setFromEuler(new Euler(...rotation))
  const delta = after.multiply(before.invert())
  const origin = new Vector3(...selected.position)
  const target = new Vector3(...position)
  return {
    ...document,
    parts: document.parts.map((part) => {
      if (!connected.has(part.id)) return part
      if (part.id === id)
        return { ...part, position: [...position], rotation: [...rotation] }
      const nextPosition = new Vector3(...part.position)
        .sub(origin)
        .applyQuaternion(delta)
        .add(target)
      const nextRotation = new Euler().setFromQuaternion(
        delta
          .clone()
          .multiply(new Quaternion().setFromEuler(new Euler(...part.rotation))),
      )
      return {
        ...part,
        position: nextPosition.toArray() as Coordinates,
        rotation: [
          nextRotation.x,
          nextRotation.y,
          nextRotation.z,
        ] as Coordinates,
      }
    }),
  }
}

function validateMates(value: unknown, parts: AssemblyPart[]): HoleMate[] {
  if (!Array.isArray(value) || value.length > Math.max(0, parts.length - 1))
    throw new Error("Invalid assembly mates")
  const mates: HoleMate[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== "object")
      throw new Error("Invalid assembly mate")
    const mate = entry as HoleMate
    const moving = parts.find((part) => part.id === mate.movingId)
    const fixed = parts.find((part) => part.id === mate.fixedId)
    const movingHole = moving && HOLES[moving.path]?.[mate.movingHole]
    const fixedHole = fixed && HOLES[fixed.path]?.[mate.fixedHole]
    if (
      !moving ||
      !fixed ||
      !movingHole ||
      !fixedHole ||
      !Number.isInteger(mate.movingHole) ||
      !Number.isInteger(mate.fixedHole) ||
      connectedParts(
        { version: 1, units: "inches", name: "", parts, mates },
        mate.movingId,
      ).has(mate.fixedId)
    )
      throw new Error("Invalid or cyclic assembly mate")
    const movingQ = new Quaternion().setFromEuler(new Euler(...moving.rotation))
    const fixedQ = new Quaternion().setFromEuler(new Euler(...fixed.rotation))
    const center = new Vector3(...movingHole.center)
      .applyQuaternion(movingQ)
      .add(new Vector3(...moving.position))
    const fixedCenter = new Vector3(...fixedHole.center)
      .applyQuaternion(fixedQ)
      .add(new Vector3(...fixed.position))
    const axis = new Vector3(...movingHole.axis).applyQuaternion(movingQ)
    const fixedAxis = new Vector3(...fixedHole.axis).applyQuaternion(fixedQ)
    if (
      center.distanceTo(fixedCenter) > 0.0001 ||
      axis.dot(fixedAxis) > -0.9999
    )
      throw new Error("Saved mate does not align its holes")
    mates.push({
      movingId: mate.movingId,
      movingHole: mate.movingHole,
      fixedId: mate.fixedId,
      fixedHole: mate.fixedHole,
    })
  }
  return mates
}

function coordinates(value: unknown): value is Coordinates {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (entry) =>
        typeof entry === "number" &&
        Number.isFinite(entry) &&
        Math.abs(entry) <= 100_000,
    )
  )
}

function copyPart(part: AssemblyPart): AssemblyPart {
  if (
    !part ||
    typeof part.id !== "string" ||
    !part.id ||
    part.id.length > 100 ||
    typeof part.path !== "string" ||
    !part.path ||
    !coordinates(part.position) ||
    !coordinates(part.rotation)
  )
    throw new Error("Invalid part or transform in assembly")
  return {
    id: part.id,
    path: part.path,
    position: [...part.position],
    rotation: [...part.rotation],
  }
}

function copyDocument(document: AssemblyDocument): AssemblyDocument {
  if (
    document.version !== 1 ||
    document.units !== "inches" ||
    typeof document.name !== "string" ||
    document.name.length > 120 ||
    !Array.isArray(document.parts) ||
    document.parts.length > 2000
  )
    throw new Error("Unsupported assembly format")
  const parts = document.parts.map(copyPart)
  if (new Set(parts.map((part) => part.id)).size !== parts.length)
    throw new Error("Duplicate part ID")
  return {
    version: 1,
    units: "inches",
    name: document.name,
    parts,
    ...(document.mates !== undefined
      ? { mates: validateMates(document.mates, parts) }
      : {}),
  }
}

export function parseAssembly(
  text: string,
  paths: ReadonlySet<string>,
): AssemblyDocument {
  if (text.length > 8 * 1024 * 1024) throw new Error("Assembly exceeds 8 MiB")
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== "object") throw new Error("Invalid assembly")
  const document = value as Partial<AssemblyDocument>
  if (
    document.version !== 1 ||
    document.units !== "inches" ||
    typeof document.name !== "string" ||
    document.name.length > 120 ||
    !Array.isArray(document.parts) ||
    document.parts.length > 2000
  )
    throw new Error("Unsupported assembly format")
  const ids = new Set<string>()
  const parts = document.parts.map((part) => {
    if (
      !part ||
      typeof part.id !== "string" ||
      !part.id ||
      part.id.length > 100 ||
      ids.has(part.id) ||
      typeof part.path !== "string" ||
      !paths.has(part.path) ||
      !coordinates(part.position) ||
      !coordinates(part.rotation)
    )
      throw new Error("Invalid part or transform in assembly")
    ids.add(part.id)
    return {
      id: part.id,
      path: part.path,
      position: [...part.position] as Coordinates,
      rotation: [...part.rotation] as Coordinates,
    }
  })
  return {
    version: 1,
    units: "inches",
    name: document.name,
    parts,
    ...(document.mates !== undefined
      ? { mates: validateMates(document.mates, parts) }
      : {}),
  }
}

export function partsList(document: AssemblyDocument) {
  const counts = new Map<string, number>()
  for (const part of document.parts)
    counts.set(part.path, (counts.get(part.path) ?? 0) + 1)
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, quantity]) => ({ path, quantity }))
}
