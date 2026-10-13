export interface DeviceNode {
  id: string
  type?: string
  data: Record<string, unknown>
}

export interface DeviceEdge {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface DistanceState {
  port: number
  distance: number
  size: number
  visible: boolean
}

export interface BatteryState {
  capacity: number
  voltage: number
  current: number
  temperature: number
}

export interface ControllerState {
  controllerId: number
  axes: [number, number, number, number]
  buttons: number
  capacity: number
  connected: boolean
}

export interface MotorState {
  port: number
}

export interface DeviceState {
  battery: BatteryState
  distances: DistanceState[]
  motors: MotorState[]
  controllers: ControllerState[]
}

function number(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Sensor values must be finite numbers")
  return Math.round(Math.max(min, Math.min(max, value)))
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new Error("Controller values must be integers")
  return Math.max(min, Math.min(max, value))
}

export function graphDeviceState(
  nodes: DeviceNode[],
  edges: DeviceEdge[],
): DeviceState {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ports = new Set<number>()
  const distances: DistanceState[] = []
  const motors: MotorState[] = []
  const controllers: ControllerState[] = []
  const controllerIds = new Set<number>()
  for (const node of nodes) {
    if (node.type !== "controller") continue
    const fallbackId = [0, 1].find((id) => !controllerIds.has(id)) ?? -1
    const controllerId = integer(node.data.controllerId, fallbackId, 0, 1)
    if (controllerId < 0 || controllerId > 1)
      throw new Error("Only two controller nodes are supported")
    if (controllerIds.has(controllerId))
      throw new Error("Only one controller node is allowed for each controller")
    controllerIds.add(controllerId)
    const axes = [
      integer(node.data.axis1, 0, -127, 127),
      integer(node.data.axis2, 0, -127, 127),
      integer(node.data.axis3, 0, -127, 127),
      integer(node.data.axis4, 0, -127, 127),
    ] as [number, number, number, number]
    const buttons = integer(node.data.buttons, 0, 0, 4095)
    controllers.push({
      controllerId,
      axes,
      buttons,
      capacity: integer(node.data.capacity, 100, 0, 100),
      connected: node.data.connected === true,
    })
  }
  for (const edge of edges) {
    if (edge.target !== "brain" || edge.sourceHandle !== "smart_port_connector")
      continue
    const match = /^smart_port_(\d+)$/.exec(edge.targetHandle ?? "")
    if (!match) continue
    const port = Number(match[1])
    if (port < 1 || port > 21 || ports.has(port))
      throw new Error("Each smart port accepts one device")
    ports.add(port)
    const node = byId.get(edge.source)
    if (node?.type === "distance") {
      distances.push({
        port,
        distance: number(node.data.distance, 1000, 20, 2000),
        size: number(node.data.size, 200, 0, 400),
        visible: node.data.objectVisible !== false,
      })
    } else if (node?.type === "motor") {
      motors.push({ port })
    }
  }
  return {
    battery: {
      capacity: number(byId.get("battery")?.data.capacity, 0, 0, 100),
      voltage: number(byId.get("battery")?.data.voltage, 12000, 0, 16000),
      current: number(byId.get("battery")?.data.current, 0, 0, 100000),
      temperature: number(byId.get("battery")?.data.temperature, 25, -40, 100),
    },
    distances: distances.sort((a, b) => a.port - b.port),
    motors: motors.sort((a, b) => a.port - b.port),
    controllers: controllers.sort((a, b) => a.controllerId - b.controllerId),
  }
}

export type DeviceRequest =
  | { command: "battery"; state: BatteryState }
  | { command: "distance"; state: DistanceState }
  | { command: "motor"; state: MotorState }
  | { command: "controller"; state: ControllerState }
  | { command: "disconnect"; port: number }

// One ordered writer coalesces rapid graph changes and replays state after reset.
export class DeviceSync {
  private desired: DeviceState | undefined
  private sent: DeviceState | undefined
  private running = false
  private generation = 0

  constructor(
    private send: (request: DeviceRequest) => Promise<void>,
    private error: (message: string) => void,
  ) {}

  update(state: DeviceState | undefined) {
    if (!state) {
      this.generation++
      this.desired = undefined
      this.sent = undefined
      return
    }
    this.desired = state
    void this.flush()
  }

  async flush(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (
        this.desired &&
        JSON.stringify(this.desired) !== JSON.stringify(this.sent)
      ) {
        const generation = this.generation
        const state = this.desired
        const requests: DeviceRequest[] = []
        if (
          JSON.stringify(state.battery) !== JSON.stringify(this.sent?.battery)
        )
          requests.push({ command: "battery", state: state.battery })
        for (const previous of this.sent?.distances ?? []) {
          if (
            !state.distances.some((next) => next.port === previous.port) ||
            state.motors.some((next) => next.port === previous.port)
          )
            requests.push({ command: "disconnect", port: previous.port })
        }
        for (const previous of this.sent?.motors ?? []) {
          if (
            !state.motors.some((next) => next.port === previous.port) ||
            state.distances.some((next) => next.port === previous.port)
          )
            requests.push({ command: "disconnect", port: previous.port })
        }
        for (const next of state.distances) {
          if (
            JSON.stringify(next) !==
            JSON.stringify(
              this.sent?.distances.find(
                (previous) => previous.port === next.port,
              ),
            )
          )
            requests.push({ command: "distance", state: next })
        }
        for (const next of state.motors) {
          if (
            !this.sent?.motors.some((previous) => previous.port === next.port)
          )
            requests.push({ command: "motor", state: next })
        }
        for (const previous of this.sent?.controllers ?? []) {
          if (
            !state.controllers.some(
              (next) => next.controllerId === previous.controllerId,
            )
          )
            requests.push({
              command: "controller",
              state: {
                ...previous,
                axes: [0, 0, 0, 0],
                buttons: 0,
                connected: false,
              },
            })
        }
        for (const next of state.controllers) {
          const previous = this.sent?.controllers.find(
            (item) => item.controllerId === next.controllerId,
          )
          if (JSON.stringify(next) !== JSON.stringify(previous))
            requests.push({ command: "controller", state: next })
        }
        for (const request of requests) {
          if (generation !== this.generation || !this.desired) break
          await this.send(request)
        }
        if (generation === this.generation && this.desired) this.sent = state
      }
      this.error("")
    } catch (reason) {
      this.error(`Device update failed: ${String(reason)}`)
    } finally {
      this.running = false
    }
  }
}
