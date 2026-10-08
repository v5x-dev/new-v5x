<script lang="ts" context="module">
  export interface DragData {
    nodeType: string
    x: number
    y: number
    valid: boolean
  }
</script>

<script lang="ts">
  import * as Sidebar from "~/lib/components/ui/sidebar"
  import * as Dialog from "~/lib/components/ui/dialog"
  import { Info } from "@lucide/svelte"
  import { Clock, Hash, PlusCircle } from "svelte-feathers"
  import {
    vexV5QemuLicense,
    vexV5QemuMaintainers,
    vexV5QemuRepo,
  } from "~/lib/credits"
  import { createEventDispatcher } from "svelte"
  import {
    ADI,
    Motor,
    Controller,
    DistanceSensor,
    OpticalSensor,
    RotationSensor,
    Magnet,
    GenericSerial,
    VisionSensor,
    AIVisionSensor,
    Potentiometer,
    GPSSensor,
    LineTracker,
    LightSensor,
  } from "~/lib/icons"
  const dispatch = createEventDispatcher<{ nodeGrab: DragData }>()
  function handleDragStart(event: MouseEvent, nodeType: string) {
    dispatch("nodeGrab", {
      nodeType,
      x: event.clientX,
      y: event.clientY,
      valid: false,
    })
  }
  const DATA_NODES = [
    {
      name: "Value",
      icon: Hash,
      node: "value",
    },
    {
      name: "Math",
      icon: PlusCircle,
      node: "math",
    },
    {
      name: "Time",
      icon: Clock,
      node: "time",
    },
  ]

  const SMART_DEVICES = [
    {
      name: "Motor",
      icon: Motor,
      node: "motor",
    },
    {
      name: "Controller",
      icon: Controller,
      node: "controller",
    },
    {
      name: "Rotation Sensor",
      icon: RotationSensor,
      node: "rotation",
    },
    {
      name: "Distance Sensor",
      icon: DistanceSensor,
      node: "distance",
    },
    {
      name: "GPS Sensor",
      icon: GPSSensor,
      node: "gps",
    },
    {
      name: "Optical Sensor",
      icon: OpticalSensor,
      node: "optical",
    },
    {
      name: "Vision Sensor",
      icon: VisionSensor,
      node: "vision",
    },
    {
      name: "AI Vision Sensor",
      icon: AIVisionSensor,
      node: "ai_vision",
    },
    {
      name: "Serial Port",
      icon: GenericSerial,
      node: "serial",
    },
    {
      name: "ADI Expander",
      icon: ADI,
      node: "adi",
    },
    {
      name: "Electromagnet",
      icon: Magnet,
      node: "electromagnet",
    },
  ]

  const ADI_DEVICES = [
    {
      name: "Potentiometer",
      icon: Potentiometer,
      node: "potentiometer",
    },
    {
      name: "Line Tracker",
      icon: LineTracker,
      node: "line_tracker",
    },
    {
      name: "Light Sensor",
      icon: LightSensor,
      node: "light_sensor",
    },
  ]

  const groups = [
    { label: "Smart devices", devices: SMART_DEVICES },
    { label: "ADI devices", devices: ADI_DEVICES },
    { label: "Data", devices: DATA_NODES },
  ]
</script>

<Sidebar.Root collapsible="icon" variant="inset">
  <Sidebar.Content>
    {#each groups as group (group.label)}
      <Sidebar.Group>
        <Sidebar.GroupLabel>{group.label}</Sidebar.GroupLabel>
        <Sidebar.GroupContent>
          <Sidebar.Menu>
            {#each group.devices as device (device.node)}
              <Sidebar.MenuItem>
                <Sidebar.MenuButton
                  title={`${device.name} (drag to add)`}
                  tooltipContent={device.name}
                  onmousedown={(event) => handleDragStart(event, device.node)}
                >
                  <svelte:component this={device.icon} />
                  <span>{device.name}</span>
                </Sidebar.MenuButton>
              </Sidebar.MenuItem>
            {/each}
          </Sidebar.Menu>
        </Sidebar.GroupContent>
      </Sidebar.Group>
    {/each}
  </Sidebar.Content>
  <Sidebar.Footer>
    <Dialog.Root>
      <Sidebar.Menu>
        <Sidebar.MenuItem>
          <Sidebar.MenuButton tooltipContent="vex-v5-qemu credits">
            {#snippet child({ props })}
              <Dialog.Trigger {...props}>
                <Info />
                <span>vex-v5-qemu</span>
              </Dialog.Trigger>
            {/snippet}
          </Sidebar.MenuButton>
        </Sidebar.MenuItem>
      </Sidebar.Menu>
      <Dialog.Content class="sm:max-w-md">
        <Dialog.Header>
          <Dialog.Title>vex-v5-qemu</Dialog.Title>
          <Dialog.Description>
            This simulator runs the
            <a href={vexV5QemuRepo}>vex-v5-qemu</a>
            kernel, protocol, and display renderer. The project is
            <a href={vexV5QemuLicense}>MIT licensed</a>.
            These are the maintainers and contributors.
          </Dialog.Description>
        </Dialog.Header>
        <ul class="flex flex-col gap-1 text-xs/relaxed">
          {#each vexV5QemuMaintainers as person (person.name)}
            <li>
              {#if "href" in person}
                <a
                  class="underline underline-offset-3 hover:text-foreground"
                  href={person.href}>{person.name}</a
                >
              {:else}
                {person.name}, named as an author of the protocol crate
              {/if}
            </li>
          {/each}
        </ul>
        <p class="text-xs/relaxed text-muted-foreground">
          QEMU, which runs that kernel in the browser, is GPL-2.0-or-later.
          <a
            class="underline underline-offset-3 hover:text-foreground"
            href="/wasm/QEMU-COPYING">QEMU's license</a
          >
          ships with this build.
          <a
            class="underline underline-offset-3 hover:text-foreground"
            href="/credits.html">Full credit</a
          >
          is also a separate page.
        </p>
      </Dialog.Content>
    </Dialog.Root>
  </Sidebar.Footer>
  <Sidebar.Rail />
</Sidebar.Root>
