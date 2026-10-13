import {
  graphDeviceState,
  type DeviceEdge,
  type DeviceNode,
} from "./device-state"

export const distanceScenario = [
  { at: 0, distance: 2000, visible: true },
  { at: 1000, distance: 1000, visible: true },
  { at: 2000, distance: 200, visible: true },
  { at: 3000, distance: 200, visible: false },
  { at: 4000, distance: 2000, visible: true },
] as const

export function scenarioFrame<T extends DeviceNode>(
  nodes: T[],
  edges: DeviceEdge[],
  elapsed: number,
): T[] {
  if (!Number.isFinite(elapsed) || elapsed < 0)
    throw new Error("Invalid scenario time")
  const state = graphDeviceState(nodes, edges)
  if (!state.distances.length)
    throw new Error("Connect a distance sensor to a Brain smart port first")
  const connected = new Set(
    edges
      .filter(
        (edge) =>
          state.distances.some(
            (sensor) => edge.targetHandle === `smart_port_${sensor.port}`,
          ) && edge.target === "brain",
      )
      .map((edge) => edge.source),
  )
  const frame = [...distanceScenario]
    .reverse()
    .find((frame) => frame.at <= elapsed)!
  return nodes.map((node) =>
    connected.has(node.id) && node.type === "distance"
      ? {
          ...node,
          data: {
            ...node.data,
            distance: frame.distance,
            objectVisible: frame.visible,
          },
        }
      : node,
  )
}
