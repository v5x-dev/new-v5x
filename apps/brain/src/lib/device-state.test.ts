/// <reference types="bun" />
import { expect, test } from "bun:test"
import {
  DeviceSync,
  graphDeviceState,
  type DeviceRequest,
} from "./device-state"

const nodes = [
  { id: "battery", type: "battery", data: { capacity: 84 } },
  {
    id: "sensor",
    type: "distance",
    data: { distance: 600, size: 200, objectVisible: true },
  },
]
const edges = [
  {
    source: "sensor",
    target: "brain",
    sourceHandle: "smart_port_connector",
    targetHandle: "smart_port_21",
  },
]

test("wiring selects the physical port and rejects duplicate ports and nonfinite data", () => {
  expect(graphDeviceState(nodes, edges)).toEqual({
    battery: { capacity: 84, voltage: 12000, current: 0, temperature: 25 },
    distances: [{ port: 21, distance: 600, size: 200, visible: true }],
    motors: [],
    controllers: [],
  })
  expect(graphDeviceState(nodes, [])).toEqual({
    battery: { capacity: 84, voltage: 12000, current: 0, temperature: 25 },
    distances: [],
    motors: [],
    controllers: [],
  })
  expect(() => graphDeviceState(nodes, [...edges, ...edges])).toThrow(
    "one device",
  )
  expect(() =>
    graphDeviceState([{ ...nodes[1], data: { distance: NaN } }], edges),
  ).toThrow("finite")
})

test("a sensor disconnect clears the guest port and reset replays current values", async () => {
  const requests: DeviceRequest[] = []
  const sync = new DeviceSync(
    async (request) => {
      requests.push(request)
    },
    () => {},
  )
  sync.update(graphDeviceState(nodes, edges))
  await new Promise((resolve) => setTimeout(resolve, 0))
  sync.update(graphDeviceState(nodes, []))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(requests).toEqual([
    {
      command: "battery",
      state: { capacity: 84, voltage: 12000, current: 0, temperature: 25 },
    },
    {
      command: "distance",
      state: { port: 21, distance: 600, size: 200, visible: true },
    },
    { command: "disconnect", port: 21 },
  ])
  sync.update(undefined)
  sync.update(graphDeviceState(nodes, edges))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(requests.slice(-2)).toEqual(requests.slice(0, 2))
})

test("a rapid edit sends the latest state after an in-flight update", async () => {
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const requests: DeviceRequest[] = []
  const sync = new DeviceSync(
    async (request) => {
      requests.push(request)
      if (requests.length === 1) await blocked
    },
    () => {},
  )
  sync.update(graphDeviceState(nodes, edges))
  sync.update(
    graphDeviceState([{ ...nodes[1], data: { distance: 1500 } }], edges),
  )
  release()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(requests.at(-1)).toMatchObject({
    command: "distance",
    state: { distance: 1500 },
  })
})

test("a wired motor is connected, removed, and replayed through its smart port", async () => {
  const motor = { id: "motor", type: "motor", data: {} }
  const edge = {
    source: "motor",
    target: "brain",
    sourceHandle: "smart_port_connector",
    targetHandle: "smart_port_2",
  }
  const state = graphDeviceState([motor], [edge])
  expect(state.motors).toEqual([{ port: 2 }])

  const requests: DeviceRequest[] = []
  const sync = new DeviceSync(
    async (request) => {
      requests.push(request)
    },
    () => {},
  )
  sync.update(state)
  await new Promise((resolve) => setTimeout(resolve, 0))
  sync.update(graphDeviceState([motor], []))
  await new Promise((resolve) => setTimeout(resolve, 0))
  sync.update(state)
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(requests.filter((request) => request.command === "motor")).toEqual([
    { command: "motor", state: { port: 2 } },
    { command: "motor", state: { port: 2 } },
  ])
  expect(
    requests.filter((request) => request.command === "disconnect"),
  ).toEqual([{ command: "disconnect", port: 2 }])
})

test("battery fields retain protocol units and replay changes", async () => {
  const requests: DeviceRequest[] = []
  const sync = new DeviceSync(
    async (request) => {
      requests.push(request)
    },
    () => {},
  )
  const state = graphDeviceState(
    [
      {
        id: "battery",
        data: { capacity: 65, voltage: 12500, current: 1500, temperature: 30 },
      },
    ],
    [],
  )
  expect(state.battery).toEqual({
    capacity: 65,
    voltage: 12500,
    current: 1500,
    temperature: 30,
  })
  sync.update(state)
  await new Promise((resolve) => setTimeout(resolve, 0))
  sync.update({ ...state, battery: { ...state.battery, voltage: 11000 } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(requests.at(-1)).toEqual({
    command: "battery",
    state: { capacity: 65, voltage: 11000, current: 1500, temperature: 30 },
  })
})

test("controller values sync by master and partner role and disconnect on removal", async () => {
  const controller = {
    id: "controller",
    type: "controller",
    data: {
      controllerId: 1,
      axis1: -127,
      axis2: 45,
      axis3: 0,
      axis4: 127,
      buttons: 2049,
      capacity: 73,
      connected: true,
    },
  }
  const state = graphDeviceState([controller], [])
  expect(state.controllers).toEqual([
    {
      controllerId: 1,
      axes: [-127, 45, 0, 127],
      buttons: 2049,
      capacity: 73,
      connected: true,
    },
  ])
  expect(() =>
    graphDeviceState(
      [controller, { ...controller, id: "second-controller" }],
      [],
    ),
  ).toThrow("one controller")

  const requests: DeviceRequest[] = []
  const sync = new DeviceSync(
    async (request) => {
      requests.push(request)
    },
    () => {},
  )
  sync.update(state)
  await new Promise((resolve) => setTimeout(resolve, 0))
  sync.update(graphDeviceState([], []))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(requests).toEqual([
    {
      command: "battery",
      state: { capacity: 0, voltage: 12000, current: 0, temperature: 25 },
    },
    { command: "controller", state: state.controllers[0] },
    {
      command: "controller",
      state: {
        ...state.controllers[0],
        axes: [0, 0, 0, 0],
        buttons: 0,
        connected: false,
      },
    },
  ])
})
