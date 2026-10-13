import { expect, test } from "bun:test"
import {
  applyScenarioFrame,
  captureFrame,
  parseScenario,
  ScenarioOutput,
} from "./saved-scenarios"

const nodes = [
  { id: "distance", type: "distance", data: { distance: 500, size: 20 } },
  {
    id: "controller",
    type: "controller",
    data: { controllerId: 0, axis1: 50, connected: true },
  },
  { id: "unwired", type: "distance", data: { distance: 700 } },
]
const edges = [
  {
    source: "distance",
    target: "brain",
    sourceHandle: "smart_port_connector",
    targetHandle: "smart_port_2",
  },
]

test("saved frames target ports and controller IDs, preserve unrelated settings and replay exactly", () => {
  const frame = captureFrame(nodes, edges, 0)
  const scenario = parseScenario(
    JSON.stringify({
      version: 1,
      name: "Drive",
      frames: [frame],
      expectations: [{ by: 2000, text: "DONE" }],
    }),
  )
  const edited = nodes.map((node) => ({
    ...node,
    data: { ...node.data, distance: 1000, axis1: 0 },
  }))
  const replayed = applyScenarioFrame(edited, edges, scenario.frames[0]!)
  expect(captureFrame(replayed, edges, 0)).toEqual(frame)
  expect(replayed[2]).toBe(edited[2])
  expect(() => applyScenarioFrame(nodes, [], frame)).toThrow("smart port 2")
  expect(() =>
    parseScenario(JSON.stringify({ ...scenario, frames: [frame, frame] })),
  ).toThrow("increasing")
  expect(() =>
    parseScenario(
      JSON.stringify({
        ...scenario,
        frames: [
          {
            ...frame,
            controllers: [{ ...frame.controllers[0], axes: [128, 0, 0, 0] }],
          },
        ],
      }),
    ),
  ).toThrow("controller")
})

test("output checks match split UTF-8 packets and fail absent or late output", () => {
  const output = new ScenarioOutput([
    { by: 1000, text: "READY ✓" },
    { by: 1000, text: "LATE" },
    { by: 1000, text: "MISSING" },
  ])
  const bytes = new TextEncoder().encode("READY ✓")
  output.push(bytes.subarray(0, bytes.length - 1), 500)
  output.push(bytes.subarray(bytes.length - 1), 900)
  output.push(new TextEncoder().encode("LATE"), 1001)
  expect(output.results().map((item) => item.passed)).toEqual([
    true,
    false,
    false,
  ])
})
