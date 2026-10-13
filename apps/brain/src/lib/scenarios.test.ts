/// <reference types="bun" />
import { expect, test } from "bun:test"
import { scenarioFrame } from "./scenarios"
import { graphDeviceState } from "./device-state"

const nodes = [
  { id: "sensor", type: "distance", data: { distance: 500, size: 200 } },
  { id: "unwired", type: "distance", data: { distance: 700 } },
]
const edges = [
  {
    source: "sensor",
    target: "brain",
    sourceHandle: "smart_port_connector",
    targetHandle: "smart_port_1",
  },
]

test("scenario produces repeatable guest states at exact boundaries", () => {
  for (const [time, distance, visible] of [
    [0, 2000, true],
    [999, 2000, true],
    [1000, 1000, true],
    [2000, 200, true],
    [3000, 200, false],
    [4000, 2000, true],
  ] as const) {
    const frame = scenarioFrame(nodes, edges, time)
    expect(graphDeviceState(frame, edges).distances).toEqual([
      { port: 1, distance, size: 200, visible },
    ])
    expect(frame[1]).toBe(nodes[1])
    expect(scenarioFrame(nodes, edges, time)).toEqual(frame)
  }
  expect(nodes[0]!.data.distance).toBe(500)
})

test("scenario rejects invalid time and disconnected sensors", () => {
  expect(() => scenarioFrame(nodes, edges, NaN)).toThrow("time")
  expect(() => scenarioFrame(nodes, [], 0)).toThrow("Connect")
})
