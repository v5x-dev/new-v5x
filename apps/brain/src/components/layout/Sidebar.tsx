import { Info } from "lucide-react"
import { useState, type ComponentType, type MouseEvent } from "react"
import { Clock, Hash, PlusCircle } from "react-feather"
import {
  ADI,
  AIVisionSensor,
  Controller,
  DistanceSensor,
  GenericSerial,
  GPSSensor,
  LightSensor,
  LineTracker,
  Magnet,
  Motor,
  OpticalSensor,
  Potentiometer,
  RotationSensor,
  VisionSensor,
} from "~/components/icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "~/components/ui/sidebar"
import { simulatedDeviceTypes } from "~/lib/configuration"
import {
  vexV5QemuLicense,
  vexV5QemuMaintainers,
  vexV5QemuRepo,
} from "~/lib/credits"
import { useApp } from "~/lib/stores"

export interface DragData {
  nodeType: string
  x: number
  y: number
  valid: boolean
}

interface Device {
  name: string
  icon: ComponentType
  node: string
}

const DATA_NODES: Device[] = [
  { name: "Value", icon: Hash, node: "value" },
  { name: "Math", icon: PlusCircle, node: "math" },
  { name: "Time", icon: Clock, node: "time" },
]

const SMART_DEVICES: Device[] = [
  { name: "Motor", icon: Motor, node: "motor" },
  { name: "Controller", icon: Controller, node: "controller" },
  { name: "Rotation Sensor", icon: RotationSensor, node: "rotation" },
  { name: "Distance Sensor", icon: DistanceSensor, node: "distance" },
  { name: "GPS Sensor", icon: GPSSensor, node: "gps" },
  { name: "Optical Sensor", icon: OpticalSensor, node: "optical" },
  { name: "Vision Sensor", icon: VisionSensor, node: "vision" },
  { name: "AI Vision Sensor", icon: AIVisionSensor, node: "ai_vision" },
  { name: "Serial Port", icon: GenericSerial, node: "serial" },
  { name: "ADI Expander", icon: ADI, node: "adi" },
  { name: "Electromagnet", icon: Magnet, node: "electromagnet" },
]

const ADI_DEVICES: Device[] = [
  { name: "Potentiometer", icon: Potentiometer, node: "potentiometer" },
  { name: "Line Tracker", icon: LineTracker, node: "line_tracker" },
  { name: "Light Sensor", icon: LightSensor, node: "light_sensor" },
]

const groups = [
  { label: "Smart devices", devices: SMART_DEVICES },
  { label: "ADI devices", devices: ADI_DEVICES },
  { label: "Data", devices: DATA_NODES },
]

const linkClass = "underline underline-offset-3 hover:text-foreground"

export function Sidebar({
  onNodeGrab,
}: {
  onNodeGrab: (data: DragData) => void
}) {
  const [creditsOpen, setCreditsOpen] = useState(false)
  const controllers = useApp(
    (state) => state.nodes.filter((node) => node.type === "controller").length,
  )
  const controllersFull = controllers >= 2

  function handleDragStart(event: MouseEvent, nodeType: string) {
    onNodeGrab({
      nodeType,
      x: event.clientX,
      y: event.clientY,
      valid: false,
    })
  }

  return (
    <SidebarRoot collapsible="icon" variant="inset">
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.devices.map((device) => {
                  const full = device.node === "controller" && controllersFull
                  const unavailable =
                    group.label !== "Data" &&
                    !simulatedDeviceTypes.has(device.node)
                  const Icon = device.icon

                  return (
                    <SidebarMenuItem key={device.node}>
                      <SidebarMenuButton
                        aria-disabled={unavailable || full}
                        title={
                          full
                            ? "Both controller slots are in use"
                            : device.name
                        }
                        tooltip={device.name}
                        onMouseDown={(event) => {
                          if (group.label === "Data" || (!unavailable && !full))
                            handleDragStart(event, device.node)
                        }}
                      >
                        <Icon />
                        <span>{device.name + (full ? " · Full" : "")}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="vex-v5-qemu credits"
              onClick={() => setCreditsOpen(true)}
            >
              <Info />
              <span>vex-v5-qemu</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <Dialog open={creditsOpen} onOpenChange={setCreditsOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>vex-v5-qemu</DialogTitle>
              <DialogDescription>
                This simulator runs the <a href={vexV5QemuRepo}>vex-v5-qemu</a>{" "}
                kernel, protocol, and display renderer. The project is{" "}
                <a href={vexV5QemuLicense}>MIT licensed</a>. These are the
                maintainers and contributors.
              </DialogDescription>
            </DialogHeader>
            <ul className="flex flex-col gap-1 text-xs/relaxed">
              {vexV5QemuMaintainers.map((person) => (
                <li key={person.name}>
                  {"href" in person ? (
                    <a className={linkClass} href={person.href}>
                      {person.name}
                    </a>
                  ) : (
                    `${person.name}, named as an author of the protocol crate`
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs/relaxed text-muted-foreground">
              QEMU, which runs that kernel in the browser, is GPL-2.0-or-later.{" "}
              <a className={linkClass} href="/wasm/QEMU-COPYING">
                QEMU's license
              </a>{" "}
              ships with this build.{" "}
              <a className={linkClass} href="/credits.html">
                Full credit
              </a>{" "}
              is also a separate page.
            </p>
          </DialogContent>
        </Dialog>
      </SidebarFooter>
      <SidebarRail />
    </SidebarRoot>
  )
}
