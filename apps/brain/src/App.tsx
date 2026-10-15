import {
  ReactFlowProvider,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react"
import { Map, Moon, Sun } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Pause, Play, Power, RefreshCw } from "react-feather"
import { DragNDropOverlay } from "~/components/DragNDropOverlay"
import { AdiEdge, DataEdge } from "~/components/edges"
import { AccountLink } from "~/components/layout/AccountLink"
import { ConfigurationControls } from "~/components/layout/ConfigurationControls"
import { Flow } from "~/components/layout/Flow"
import { Sidebar, type DragData } from "~/components/layout/Sidebar"
import { Terminal } from "~/components/layout/Terminal"
import { Toolbar } from "~/components/layout/Toolbar"
import {
  AdiNode,
  BatteryNode,
  BrainNode,
  ControllerNode,
  DistanceNode,
  GpsNode,
  LightSensorNode,
  MathNode,
  MotorNode,
  TimeNode,
  ValueNode,
} from "~/components/nodes"
import { Button } from "~/components/ui/button"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/ui/sidebar"
import { DeviceSync, graphDeviceState } from "~/lib/device-state"
import { desktop, listen, request } from "~/lib/runtime"
import Session from "~/lib/session"
import { receiveSimulatorHandoff } from "~/lib/simulator-handoff"
import {
  persistConfiguration,
  setSession,
  useApp,
  useSession,
} from "~/lib/stores"
import { getTerminalTheme } from "~/lib/terminal-theme"

const nodeTypes: NodeTypes = {
  brain: BrainNode,
  adi: AdiNode,
  battery: BatteryNode,
  gps: GpsNode,
  distance: DistanceNode,
  value: ValueNode,
  math: MathNode,
  time: TimeNode,
  light_sensor: LightSensorNode,
  motor: MotorNode,
  controller: ControllerNode,
}

const edgeTypes: EdgeTypes = {
  data: DataEdge,
  adi: AdiEdge,
}

const decoder = new TextDecoder("UTF-8")

function initialMinimapVisible() {
  const stored = window.localStorage.getItem("minimap")
  if (stored === "on" || stored === "off") return stored === "on"
  return window.matchMedia("(min-width: 768px)").matches
}

export function App() {
  const nodes = useApp((state) => state.nodes)
  const edges = useApp((state) => state.edges)
  const terminal = useApp((state) => state.terminal)
  const configurationError = useApp((state) => state.configurationError)
  const configurationRevision = useApp((state) => state.configurationRevision)
  const { running, paused } = useSession()

  const [deviceError, setDeviceError] = useState("")
  const [handoffStatus, setHandoffStatus] = useState("")
  const [dark, setDark] = useState(
    () => window.localStorage.getItem("theme") !== "light",
  )
  const [showMinimap, setShowMinimap] = useState(initialMinimapVisible)
  const [dragNode, setDragNode] = useState<DragData | null>(null)

  const deviceSync = useRef<DeviceSync | undefined>(undefined)
  deviceSync.current ??= new DeviceSync(
    async (update) => {
      const body =
        update.command === "disconnect" ? { port: update.port } : update.state
      await request(update.command, new Blob([JSON.stringify(body)]))
    },
    (message) => {
      setDeviceError(message)
    },
  )

  useEffect(() => {
    try {
      deviceSync.current!.update(
        running ? graphDeviceState(nodes, edges) : undefined,
      )
    } catch (reason) {
      setDeviceError(String(reason))
    }
  }, [running, nodes, edges])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    window.localStorage.setItem("theme", dark ? "dark" : "light")
    if (terminal) terminal.options.theme = getTerminalTheme()
  }, [dark, terminal])

  function setMinimap(pressed: boolean) {
    setShowMinimap(pressed)
    window.localStorage.setItem("minimap", pressed ? "on" : "off")
  }

  useEffect(() => {
    const stopPersistence = persistConfiguration()
    const unlisten: (() => void)[] = []
    let active = true

    const write = (event: { payload: number[] }) => {
      useApp
        .getState()
        .terminal?.write(decoder.decode(new Uint8Array(event.payload)))
    }
    void Promise.all([
      listen<number[]>("brain_usb_recv", write),
      listen<number[]>("motor_command", write),
    ]).then((handlers) => {
      if (active) unlisten.push(...handlers)
      else handlers.forEach((fn) => fn())
    })

    void (async () => {
      const fragment = window.location.hash
      if (!fragment.includes("v5x-handoff")) return
      history.replaceState(
        history.state,
        "",
        `${location.pathname}${location.search}`,
      )
      try {
        const trustedEndpoint = import.meta.env.VITE_CODE_CONVEX_SITE_URL
        if (!trustedEndpoint)
          throw new Error("Brain is missing its trusted Code handoff endpoint.")
        const handoff = await receiveSimulatorHandoff(fragment, trustedEndpoint)
        if (!handoff) return
        const file = new File(
          [handoff.bytes.slice().buffer],
          handoff.manifest.artifact.path.split("/").at(-1)!,
          {
            type: "application/octet-stream",
          },
        )
        const next = new Session(file.name, file)
        await next.start()
        setHandoffStatus(
          `Running ${handoff.manifest.template} build ${handoff.manifest.commitSha.slice(0, 8)}`,
        )
      } catch (reason) {
        setHandoffStatus(`Simulator handoff failed: ${String(reason)}`)
      }
    })()

    const handleWindowKeyDown = ({ key, ctrlKey, metaKey }: KeyboardEvent) => {
      if ((ctrlKey || metaKey) && key == "r") {
        void useApp.getState().session?.reset()
      }
    }
    window.addEventListener("keydown", handleWindowKeyDown)

    return () => {
      active = false
      window.removeEventListener("keydown", handleWindowKeyDown)
      deviceSync.current?.update(undefined)
      void useApp.getState().session?.stop()
      unlisten.splice(0).forEach((fn) => fn())
      stopPersistence()
    }
  }, [])

  const pauseLabel = (paused ? "Unpause" : "Pause") + " execution"
  const themeLabel = dark ? "Switch to light mode" : "Switch to dark mode"
  const minimapLabel = showMinimap ? "Hide minimap" : "Show minimap"

  return (
    <SidebarProvider className="h-full min-h-0">
      <ReactFlowProvider>
        <div className="split-view flex h-full w-full">
          <DragNDropOverlay
            dragNode={dragNode}
            setDragNode={setDragNode}
            nodeTypes={nodeTypes}
          />
          <Sidebar onNodeGrab={setDragNode} />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar">
            {configurationError && <p role="alert">{configurationError}</p>}
            {deviceError && <p role="alert">{deviceError}</p>}
            {handoffStatus && <p role="status">{handoffStatus}</p>}
            <Toolbar
              left={
                <>
                  <SidebarTrigger size="icon" title="Toggle sidebar" />
                  <Button
                    variant="ghost"
                    size="icon"
                    title={pauseLabel}
                    aria-label={pauseLabel}
                    disabled={!running || desktop}
                    onClick={() =>
                      void useApp.getState().session?.togglePause()
                    }
                  >
                    {paused ? <Play size="16" /> : <Pause size="16" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Reset program"
                    aria-label="Reset program"
                    disabled={!running}
                    onClick={() => void useApp.getState().session?.reset()}
                  >
                    <RefreshCw size="16" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Unload program"
                    aria-label="Unload program"
                    disabled={!running}
                    onClick={() => {
                      void useApp.getState().session?.stop()
                      setSession(null)
                    }}
                  >
                    <Power size="16" />
                  </Button>
                </>
              }
              right={
                <>
                  <ConfigurationControls />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-pressed={showMinimap}
                    className="aria-pressed:bg-muted"
                    onClick={() => setMinimap(!showMinimap)}
                    title={minimapLabel}
                    aria-label={minimapLabel}
                  >
                    <Map size="16" />
                  </Button>
                  <AccountLink />
                  <Button
                    variant="ghost"
                    size="icon"
                    title={themeLabel}
                    aria-label={themeLabel}
                    onClick={() => setDark(!dark)}
                  >
                    {dark ? <Sun /> : <Moon />}
                  </Button>
                </>
              }
            />
            <SidebarInset className="min-h-0 w-auto min-w-0 overflow-hidden md:m-2 md:mt-0 md:ml-0 md:rounded-xl md:shadow-sm">
              <div className="app-left relative flex min-h-0 flex-auto flex-col overflow-hidden bg-background">
                <section
                  className="display-view relative flex min-h-0 flex-auto items-center-safe justify-center overflow-auto bg-[linear-gradient(var(--card)_1px,transparent_1px),linear-gradient(90deg,var(--card)_1px,transparent_1px)] bg-size-[20px_20px] bg-position-[-1px_-1px]"
                  role="application"
                >
                  <Flow
                    key={configurationRevision}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    showMinimap={showMinimap}
                  />
                </section>
                <Terminal />
              </div>
            </SidebarInset>
          </div>
        </div>
      </ReactFlowProvider>
    </SidebarProvider>
  )
}
