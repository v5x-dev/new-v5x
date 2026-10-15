import {
  configurationKey,
  parseConfiguration,
  simulationConfiguration,
  type SimulationConfiguration,
} from "./configuration"
import type { Terminal } from "@xterm/xterm"
import type Session from "~/lib/session"
import type { Edge, Node } from "@xyflow/react"

import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

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

let restored = simulationConfiguration(defaultNodes, defaultEdges)
let restoreFailed = false
let restoreError = ""
try {
  const text = localStorage.getItem(configurationKey)
  if (text) restored = parseConfiguration(text)
} catch (reason) {
  restoreFailed = true
  restoreError = `Unable to restore wiring: ${String(reason)}. Export your configuration before replacing it.`
}

interface AppState {
  session: Session | null
  terminal: Terminal | null
  nodes: Node[]
  edges: Edge[]
  configurationError: string
  configurationRevision: number
}

export const useApp = create<AppState>(() => ({
  session: null,
  terminal: null,
  nodes: restored.nodes,
  edges: restored.edges,
  configurationError: restoreError,
  configurationRevision: 0,
}))

// Sessions mutate in place, so publishing the same instance still notifies
// subscribers of the primitives they select from it.
export function setSession(session: Session | null) {
  useApp.setState({ session })
}

export function setTerminal(terminal: Terminal | null) {
  useApp.setState({ terminal })
}

export function setConfigurationError(configurationError: string) {
  useApp.setState({ configurationError })
}

export function setNodes(nodes: Node[] | ((current: Node[]) => Node[])) {
  useApp.setState((state) => ({
    nodes: typeof nodes === "function" ? nodes(state.nodes) : nodes,
  }))
}

export function setEdges(edges: Edge[] | ((current: Edge[]) => Edge[])) {
  useApp.setState((state) => ({
    edges: typeof edges === "function" ? edges(state.edges) : edges,
  }))
}

export function updateNodeData(id: string, data: Record<string, unknown>) {
  setNodes((current) => {
    const index = current.findIndex((node) => node.id === id)
    const node = current[index]
    if (!node) return current
    const changed = Object.entries(data).some(
      ([key, value]) => !Object.is(node.data[key], value),
    )
    if (!changed) return current
    const next = current.slice()
    next[index] = { ...node, data: { ...node.data, ...data } }
    return next
  })
}

export function useSession() {
  return useApp(
    useShallow((state) => ({
      session: state.session,
      running: state.session?.running ?? false,
      paused: state.session?.paused ?? false,
    })),
  )
}

export function installConfiguration(configuration: SimulationConfiguration) {
  localStorage.setItem(configurationKey, JSON.stringify(configuration))
  restoreFailed = false
  useApp.setState((state) => ({
    nodes: configuration.nodes,
    edges: configuration.edges,
    configurationRevision: state.configurationRevision + 1,
    configurationError: "",
  }))
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
      setConfigurationError("")
    } catch (reason) {
      setConfigurationError(
        `Wiring not saved: ${String(reason)}. Export a recovery copy.`,
      )
    }
  }
  let previous: Pick<AppState, "nodes" | "edges"> | undefined
  const track = (state: AppState) => {
    if (previous?.nodes === state.nodes && previous.edges === state.edges)
      return
    previous = state
    const text = JSON.stringify(
      simulationConfiguration(state.nodes, state.edges),
    )
    if (text === pending) return
    pending = text
    clearTimeout(timer)
    timer = setTimeout(flush, 150)
  }
  track(useApp.getState())
  const unsubscribe = useApp.subscribe(track)
  window.addEventListener("pagehide", flush)
  return () => {
    flush()
    unsubscribe()
    window.removeEventListener("pagehide", flush)
  }
}
