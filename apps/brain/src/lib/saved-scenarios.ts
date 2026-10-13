import {
  graphDeviceState,
  type DeviceNode,
  type DeviceEdge,
  type DistanceState,
  type ControllerState,
} from "./device-state"

export interface ScenarioFrame {
  at: number
  distances: DistanceState[]
  controllers: ControllerState[]
}

export interface SavedScenario {
  version: 1
  name: string
  frames: ScenarioFrame[]
  expectations: { by: number; text: string }[]
}

export const scenarioKey = "v5x-brain-scenario"
export const emptyScenario = (): SavedScenario => ({
  version: 1,
  name: "Robot check",
  frames: [],
  expectations: [],
})

export function captureFrame(
  nodes: DeviceNode[],
  edges: DeviceEdge[],
  at: number,
): ScenarioFrame {
  const { distances, controllers } = graphDeviceState(nodes, edges)
  return { at, distances, controllers }
}

export function parseScenario(text: string): SavedScenario {
  if (text.length > 1024 * 1024) throw new Error("Scenario exceeds 1 MiB")
  const value = JSON.parse(text) as SavedScenario
  const time = (at: number) => Number.isInteger(at) && at >= 0 && at <= 600_000
  if (
    !value ||
    value.version !== 1 ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 120 ||
    !Array.isArray(value.frames) ||
    !value.frames.length ||
    value.frames.length > 1000 ||
    !Array.isArray(value.expectations) ||
    value.expectations.length > 100
  )
    throw new Error("Invalid scenario document")
  let previous = -1
  for (const frame of value.frames) {
    if (
      !frame ||
      !time(frame.at) ||
      frame.at <= previous ||
      !Array.isArray(frame.distances) ||
      !Array.isArray(frame.controllers) ||
      frame.distances.length > 21 ||
      frame.controllers.length > 2
    )
      throw new Error(
        "Frames must have increasing times between 0 and 600000 ms",
      )
    previous = frame.at
    const ports = new Set<number>()
    for (const sensor of frame.distances) {
      if (
        !sensor ||
        !Number.isInteger(sensor.port) ||
        sensor.port < 1 ||
        sensor.port > 21 ||
        ports.has(sensor.port) ||
        !Number.isInteger(sensor.distance) ||
        sensor.distance < 20 ||
        sensor.distance > 2000 ||
        !Number.isInteger(sensor.size) ||
        sensor.size < 0 ||
        sensor.size > 400 ||
        typeof sensor.visible !== "boolean"
      )
        throw new Error("Invalid scenario distance sensor")
      ports.add(sensor.port)
    }
    const ids = new Set<number>()
    for (const controller of frame.controllers) {
      if (
        !controller ||
        ![0, 1].includes(controller.controllerId) ||
        ids.has(controller.controllerId) ||
        !Array.isArray(controller.axes) ||
        controller.axes.length !== 4 ||
        controller.axes.some(
          (axis) => !Number.isInteger(axis) || axis < -127 || axis > 127,
        ) ||
        !Number.isInteger(controller.buttons) ||
        controller.buttons < 0 ||
        controller.buttons > 4095 ||
        !Number.isInteger(controller.capacity) ||
        controller.capacity < 0 ||
        controller.capacity > 100 ||
        typeof controller.connected !== "boolean"
      )
        throw new Error("Invalid scenario controller")
      ids.add(controller.controllerId)
    }
  }
  for (const expectation of value.expectations) {
    if (
      !expectation ||
      !time(expectation.by) ||
      typeof expectation.text !== "string" ||
      !expectation.text ||
      expectation.text.length > 1000
    )
      throw new Error(
        "Expected output needs text and a deadline in milliseconds",
      )
  }
  return value
}

export function applyScenarioFrame<T extends DeviceNode>(
  nodes: T[],
  edges: DeviceEdge[],
  frame: ScenarioFrame,
): T[] {
  const state = graphDeviceState(nodes, edges)
  for (const sensor of frame.distances)
    if (!state.distances.some((entry) => entry.port === sensor.port))
      throw new Error(`Connect a distance sensor to smart port ${sensor.port}`)
  for (const controller of frame.controllers)
    if (
      !state.controllers.some(
        (entry) => entry.controllerId === controller.controllerId,
      )
    )
      throw new Error(`Add controller ${controller.controllerId + 1}`)
  const connected = new Map(
    edges
      .filter(
        (edge) =>
          edge.target === "brain" &&
          edge.sourceHandle === "smart_port_connector",
      )
      .map((edge) => [
        edge.source,
        Number(edge.targetHandle?.replace("smart_port_", "")),
      ]),
  )
  const controllerNodes = nodes.filter((node) => node.type === "controller")
  const controllerIds = new Map<string, number>()
  const used = new Set<number>()
  for (const node of controllerNodes) {
    const id = Number(
      node.data.controllerId ??
        [0, 1].find((candidate) => !used.has(candidate)),
    )
    used.add(id)
    controllerIds.set(node.id, id)
  }
  return nodes.map((node) => {
    const sensor =
      node.type === "distance" &&
      frame.distances.find((entry) => entry.port === connected.get(node.id))
    if (sensor)
      return {
        ...node,
        data: {
          ...node.data,
          distance: sensor.distance,
          size: sensor.size,
          objectVisible: sensor.visible,
        },
      }
    const id = controllerIds.get(node.id)
    const controller =
      node.type === "controller" &&
      frame.controllers.find((entry) => entry.controllerId === id)
    if (controller)
      return {
        ...node,
        data: {
          ...node.data,
          controllerId: controller.controllerId,
          axis1: controller.axes[0],
          axis2: controller.axes[1],
          axis3: controller.axes[2],
          axis4: controller.axes[3],
          buttons: controller.buttons,
          capacity: controller.capacity,
          connected: controller.connected,
        },
      }
    return node
  })
}

// Keep byte chunks intact across multibyte UTF-8 boundaries and match across packets.
export class ScenarioOutput {
  private decoder = new TextDecoder()
  private output = ""
  private matched = new Set<number>()
  constructor(private expectations: SavedScenario["expectations"]) {}
  push(bytes: Uint8Array, elapsed: number) {
    this.output = (
      this.output + this.decoder.decode(bytes, { stream: true })
    ).slice(-128_000)
    this.expectations.forEach((expectation, index) => {
      if (elapsed <= expectation.by && this.output.includes(expectation.text))
        this.matched.add(index)
    })
  }
  results() {
    return this.expectations.map((expectation, index) => ({
      ...expectation,
      passed: this.matched.has(index),
    }))
  }
}
