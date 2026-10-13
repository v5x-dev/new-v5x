import {
  configurationKey,
  parseConfiguration,
  simulationConfiguration,
  type SimulationConfiguration,
} from "./configuration"
import type { Terminal } from "@xterm/xterm"
import type Session from "~/lib/session"
import type { Edge, Node } from "@xyflow/svelte"

import { derived, writable, type Writable } from "svelte/store"

export const session: Writable<Session | null> = writable(null)
export const terminal: Writable<Terminal | null> = writable(null)
export const display: Writable<CanvasRenderingContext2D | null> = writable(null)
const defaultNodes: Node[] = [
  {
    id: "brain",
    type: "brain",
    data: {},
    position: { x: 0, y: 0 },
    deletable: false,
  },
  {
    id: "battery",
    type: "battery",
    data: {
      capacity: 100,
      temperature: 25,
      current: 0,
      voltage: 12000,
    },
    position: { x: 690, y: 292.5 },
    deletable: false,
  },
  {
    id: "onboard_adi",
    type: "adi",
    data: {
      onboard: true,
    },
    position: { x: -80, y: 124 },
    deletable: false,
  },
]
const defaultEdges: Edge[] = [
  {
    id: "battery_connection",
    type: "default",
    source: "battery",
    target: "brain",
    sourceHandle: "connector",
    targetHandle: "battery_port",
    deletable: false,
  },
  {
    id: "onboard_adi_connection",
    type: "default",
    source: "onboard_adi",
    target: "brain",
    sourceHandle: "smart_port_connector",
    targetHandle: "smart_port_onboard_adi",
    deletable: false,
  },
]

export const configurationError = writable("")
let restored = simulationConfiguration(defaultNodes, defaultEdges)
let restoreFailed = false
try {
  const text = localStorage.getItem(configurationKey)
  if (text) restored = parseConfiguration(text)
} catch (reason) {
  restoreFailed = true
  configurationError.set(
    `Unable to restore wiring: ${String(reason)}. Export your configuration before replacing it.`,
  )
}
export const nodes = writable<Node[]>(restored.nodes)
export const edges = writable<Edge[]>(restored.edges)
export const configurationRevision = writable(0)

export function installConfiguration(configuration: SimulationConfiguration) {
  localStorage.setItem(configurationKey, JSON.stringify(configuration))
  restoreFailed = false
  nodes.set(configuration.nodes)
  edges.set(configuration.edges)
  configurationRevision.update((revision) => revision + 1)
  configurationError.set("")
}

export function persistConfiguration() {
  let pending = ""
  let last = ""
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    clearTimeout(timer)
    if (!pending || pending === last || restoreFailed) return
    try {
      localStorage.setItem(configurationKey, pending)
      last = pending
      configurationError.set("")
    } catch (reason) {
      configurationError.set(
        `Wiring not saved: ${String(reason)}. Export a recovery copy.`,
      )
    }
  }
  const unsubscribe = derived([nodes, edges], ([$nodes, $edges]) =>
    JSON.stringify(simulationConfiguration($nodes, $edges)),
  ).subscribe((text) => {
    if (text === pending) return
    pending = text
    clearTimeout(timer)
    timer = setTimeout(flush, 150)
  })
  window.addEventListener("pagehide", flush)
  return () => {
    flush()
    unsubscribe()
    window.removeEventListener("pagehide", flush)
  }
}
