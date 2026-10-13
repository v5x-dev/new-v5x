export type Coordinates = [number, number, number]

export interface AssemblyPart {
  id: string
  path: string
  position: Coordinates
  rotation: Coordinates
}

export interface AssemblyDocument {
  version: 1
  units: "inches"
  name: string
  parts: AssemblyPart[]
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
      document = {
        ...current,
        parts: current.parts.map((part) =>
          part.id === command.id
            ? {
                ...part,
                position: [...command.position],
                rotation: [...command.rotation],
              }
            : part,
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
  return { version: 1, units: "inches", name: document.name, parts }
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
  return { version: 1, units: "inches", name: document.name, parts }
}

export function partsList(document: AssemblyDocument) {
  const counts = new Map<string, number>()
  for (const part of document.parts)
    counts.set(part.path, (counts.get(part.path) ?? 0) + 1)
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, quantity]) => ({ path, quantity }))
}
