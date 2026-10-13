/// <reference types="bun" />
import { expect, test } from "bun:test"
import { parseConfiguration, simulationConfiguration } from "./configuration"

const nodes = [
  { id: "brain", type: "brain", position: { x: 0, y: 0 }, data: {} },
  {
    id: "battery",
    type: "battery",
    position: { x: 2, y: 3 },
    data: { capacity: 84 },
  },
  {
    id: "onboard_adi",
    type: "adi",
    position: { x: 0, y: 4 },
    data: { onboard: true },
  },
  {
    id: "sensor",
    type: "distance",
    position: { x: 40, y: 50 },
    data: { distance: 1230, objectVisible: false },
  },
]
const edges = [
  {
    id: "battery_connection",
    type: "default",
    source: "battery",
    target: "brain",
    sourceHandle: "connector",
    targetHandle: "battery_port",
  },
  {
    id: "onboard_adi_connection",
    type: "default",
    source: "onboard_adi",
    target: "brain",
    sourceHandle: "smart_port_connector",
    targetHandle: "smart_port_onboard_adi",
  },
  {
    id: "wire",
    type: "default",
    source: "sensor",
    target: "brain",
    sourceHandle: "smart_port_connector",
    targetHandle: "smart_port_8",
  },
]

test("saved configurations preserve sensor values and wiring without xyflow runtime fields", () => {
  const configuration = simulationConfiguration(
    nodes.map((node) => ({ ...node, selected: true })),
    edges,
  )
  const restored = parseConfiguration(JSON.stringify(configuration))
  expect(restored).toEqual(configuration)
  expect(restored.nodes[3].data).toEqual({
    distance: 1230,
    objectVisible: false,
  })
  expect(restored.nodes[3]).not.toHaveProperty("selected")
  expect(restored.nodes[0].deletable).toBe(false)
})

test("unknown nodes, missing devices, invalid settings, and dangling wires are rejected", () => {
  const configuration = simulationConfiguration(nodes, edges)
  expect(() =>
    parseConfiguration(
      JSON.stringify({ ...configuration, nodes: nodes.slice(1) }),
    ),
  ).toThrow("required device")
  expect(() =>
    parseConfiguration(
      JSON.stringify({
        ...configuration,
        nodes: [...nodes, { ...nodes[3], id: "unknown", type: "unknown" }],
      }),
    ),
  ).toThrow("Invalid simulation node")
  expect(() =>
    parseConfiguration(
      JSON.stringify({
        ...configuration,
        edges: [{ ...edges[0], source: "missing" }],
      }),
    ),
  ).toThrow("connection")
  expect(() =>
    parseConfiguration(
      JSON.stringify({
        ...configuration,
        nodes: nodes.map((node) =>
          node.id === "sensor"
            ? { ...node, data: { distance: "x".repeat(121) } }
            : node,
        ),
      }),
    ),
  ).toThrow("setting")
})

test("required wiring cannot be removed, redirected, or duplicated during import", () => {
  const configuration = simulationConfiguration(nodes, edges)
  expect(() =>
    parseConfiguration(
      JSON.stringify({ ...configuration, edges: edges.slice(1) }),
    ),
  ).toThrow("required connection")
  expect(() =>
    parseConfiguration(
      JSON.stringify({
        ...configuration,
        edges: edges.map((edge) =>
          edge.id === "battery_connection"
            ? { ...edge, source: "sensor" }
            : edge,
        ),
      }),
    ),
  ).toThrow("required connection")
  expect(() =>
    parseConfiguration(
      JSON.stringify({
        ...configuration,
        edges: [...edges, { ...edges[0], id: "duplicate" }],
      }),
    ),
  ).toThrow("more than one connection")
})

test("controller roles and values are validated and legacy roles are assigned", () => {
  const configuration = simulationConfiguration(nodes, edges)
  const controller = {
    id: "controller",
    type: "controller",
    position: { x: 20, y: 30 },
    data: {
      axis1: -127,
      axis2: 127,
      buttons: 4095,
      capacity: 100,
      connected: true,
    },
  }
  const restored = parseConfiguration(
    JSON.stringify({ ...configuration, nodes: [...nodes, controller] }),
  )
  expect(restored.nodes.at(-1)?.data).toMatchObject({
    controllerId: 0,
    ...controller.data,
  })

  for (const data of [
    { controllerId: 2 },
    { controllerId: 0.5 },
    { axis1: -128 },
    { axis4: 128 },
    { buttons: 4096 },
    { capacity: -1 },
    { capacity: 101 },
  ]) {
    expect(() =>
      parseConfiguration(
        JSON.stringify({
          ...configuration,
          nodes: [...nodes, { ...controller, data }],
        }),
      ),
    ).toThrow("controller")
  }

  expect(() =>
    parseConfiguration(
      JSON.stringify({
        ...configuration,
        nodes: [
          ...nodes,
          { ...controller, data: { controllerId: 1 } },
          { ...controller, id: "controller2", data: { controllerId: 1 } },
        ],
      }),
    ),
  ).toThrow("duplicate controller")
})
