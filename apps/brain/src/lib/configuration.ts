import type { Edge, Node } from "@xyflow/react"

export interface SimulationConfiguration {
  version: 1
  nodes: Node[]
  edges: Edge[]
}

const fields: Record<string, string[]> = {
  brain: [],
  battery: ["capacity", "temperature", "current", "voltage"],
  controller: [
    "controllerId",
    "axis1",
    "axis2",
    "axis3",
    "axis4",
    "buttons",
    "capacity",
    "connected",
  ],
  adi: ["onboard"],
  distance: ["distance", "size", "objectVisible"],
  value: ["value", "currentTab", "constant"],
  math: ["lhs", "rhs", "operation", "currentTab"],
  time: ["updateRate", "advanced"],
  gps: [],
  motor: [],
  light_sensor: ["brightness"],
}

export const simulatedDeviceTypes = new Set(["distance", "motor", "controller"])
export const configurationKey = "v5x-brain-configuration"

export function simulationConfiguration(
  nodes: Node[],
  edges: Edge[],
): SimulationConfiguration {
  return {
    version: 1,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: { ...node.position },
      data: Object.fromEntries(
        (fields[node.type ?? ""] ?? [])
          .filter((key) => node.data[key] !== undefined)
          .map((key) => [key, node.data[key]]),
      ),
      ...(["brain", "battery", "onboard_adi"].includes(node.id)
        ? { deletable: false }
        : {}),
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type ?? "default",
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      ...(["battery_connection", "onboard_adi_connection"].includes(edge.id)
        ? { deletable: false }
        : {}),
    })),
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120
}

export function parseConfiguration(text: string): SimulationConfiguration {
  if (text.length > 8 * 1024 * 1024)
    throw new Error("Configuration exceeds 8 MiB")
  const value: unknown = JSON.parse(text)
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    value.nodes.length > 1000 ||
    value.edges.length > 4000
  )
    throw new Error("Unsupported simulation configuration")
  const ids = new Set<string>()
  const controllerIds = new Set<number>()
  const nodes: Node[] = value.nodes.map((node) => {
    if (
      !record(node) ||
      !identifier(node.id) ||
      ids.has(node.id) ||
      typeof node.type !== "string" ||
      !Object.hasOwn(fields, node.type) ||
      !record(node.data) ||
      !record(node.position) ||
      ![node.position.x, node.position.y].every(
        (number) =>
          typeof number === "number" &&
          Number.isFinite(number) &&
          Math.abs(number) <= 100_000,
      )
    )
      throw new Error("Invalid simulation node")
    ids.add(node.id)
    const data: Record<string, unknown> = {}
    for (const key of fields[node.type]) {
      const entry = node.data[key]
      if (entry === undefined) continue
      const stringFields = ["currentTab", "constant", "operation"]
      const booleanFields = [
        "onboard",
        "objectVisible",
        "advanced",
        "connected",
      ]
      if (
        stringFields.includes(key)
          ? typeof entry !== "string" || entry.length > 120
          : booleanFields.includes(key)
            ? typeof entry !== "boolean"
            : typeof entry !== "number" || !Number.isFinite(entry)
      )
        throw new Error("Invalid device setting")
      data[key] = entry
    }
    if (node.type === "controller") {
      const controllerId =
        data.controllerId ??
        [0, 1].find((candidate) => !controllerIds.has(candidate))
      if (
        typeof controllerId !== "number" ||
        !Number.isInteger(controllerId) ||
        controllerId < 0 ||
        controllerId > 1 ||
        controllerIds.has(controllerId)
      )
        throw new Error("Invalid or duplicate controller ID")
      controllerIds.add(controllerId)
      data.controllerId = controllerId

      for (const axis of ["axis1", "axis2", "axis3", "axis4"]) {
        const setting = data[axis]
        if (
          setting !== undefined &&
          (!Number.isInteger(setting) ||
            (setting as number) < -127 ||
            (setting as number) > 127)
        )
          throw new Error("Invalid controller axis")
      }

      const buttons = data.buttons
      if (
        buttons !== undefined &&
        (!Number.isInteger(buttons) ||
          (buttons as number) < 0 ||
          (buttons as number) > 4095)
      )
        throw new Error("Invalid controller button mask")

      const capacity = data.capacity
      if (
        capacity !== undefined &&
        (!Number.isInteger(capacity) ||
          (capacity as number) < 0 ||
          (capacity as number) > 100)
      )
        throw new Error("Invalid controller battery capacity")
    }
    return {
      id: node.id,
      type: node.type,
      data,
      position: { x: node.position.x as number, y: node.position.y as number },
    }
  })
  for (const [id, type] of [
    ["brain", "brain"],
    ["battery", "battery"],
    ["onboard_adi", "adi"],
  ]) {
    if (!nodes.some((node) => node.id === id && node.type === type))
      throw new Error("Configuration is missing a required device")
  }
  const edgeIds = new Set<string>()
  const edges: Edge[] = value.edges.map((edge) => {
    if (
      !record(edge) ||
      !identifier(edge.id) ||
      edgeIds.has(edge.id) ||
      typeof edge.source !== "string" ||
      !ids.has(edge.source) ||
      typeof edge.target !== "string" ||
      !ids.has(edge.target) ||
      (edge.type !== undefined &&
        !["default", "data", "adi"].includes(String(edge.type))) ||
      ![edge.sourceHandle, edge.targetHandle].every(
        (handle) =>
          handle == null ||
          (typeof handle === "string" && handle.length <= 120),
      )
    )
      throw new Error("Invalid simulation connection")
    edgeIds.add(edge.id)
    return {
      id: edge.id,
      type: typeof edge.type === "string" ? edge.type : "default",
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle as string | null,
      targetHandle: edge.targetHandle as string | null,
    }
  })
  const requiredConnections = [
    {
      id: "battery_connection",
      source: "battery",
      target: "brain",
      sourceHandle: "connector",
      targetHandle: "battery_port",
    },
    {
      id: "onboard_adi_connection",
      source: "onboard_adi",
      target: "brain",
      sourceHandle: "smart_port_connector",
      targetHandle: "smart_port_onboard_adi",
    },
  ]
  for (const required of requiredConnections) {
    const edge = edges.find((connection) => connection.id === required.id)
    if (
      !edge ||
      edge.type !== "default" ||
      Object.entries(required).some(
        ([key, entry]) => edge[key as keyof Edge] !== entry,
      )
    )
      throw new Error("Configuration is missing a required connection")
    if (
      edges.some(
        (connection) =>
          connection.id !== required.id &&
          connection.target === required.target &&
          connection.targetHandle === required.targetHandle,
      )
    )
      throw new Error("A required device port has more than one connection")
  }
  // xyflow omits the default edge type; normalize it when exporting/importing.
  return simulationConfiguration(nodes, edges)
}
