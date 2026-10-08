<script lang="ts">
  import { onDestroy, onMount } from "svelte"

  import { desktop, listen } from "~/lib/runtime"
  type UnlistenFn = () => void

  import { SvelteFlowProvider, type NodeTypes } from "@xyflow/svelte"

  import * as SidebarUI from "~/lib/components/ui/sidebar"

  import Session from "~/lib/session"
  import { terminal, session, nodes, edges } from "~/lib/stores"
  import { Button as IconButton } from "~/lib/components/ui/button"
  import { Toggle } from "~/lib/components/ui/toggle"
  import { Sun, Moon, Map } from "@lucide/svelte"
  import { Toolbar, Sidebar, Flow, Terminal } from "~/lib/layout"
  import {
    BrainNode,
    AdiNode,
    BatteryNode,
    GpsNode,
    DistanceNode,
    ValueNode,
    MathNode,
    TimeNode,
    LightSensorNode,
    MotorNode,
  } from "~/lib/nodes"
  import { AdiEdge, DataEdge } from "~/lib/edges"

  import { Pause, Play, RefreshCw, Power } from "svelte-feathers"

  import "@xyflow/svelte/dist/style.css"
  import type { DragData } from "./lib/layout/Sidebar.svelte"
  import NodeBase from "./lib/components/NodeBase.svelte"
  import DragNDropOverlay from "./lib/components/DragNDropOverlay.svelte"

  let dark = window.localStorage.getItem("theme") !== "light"

  function initialMinimapVisible() {
    const stored = window.localStorage.getItem("minimap")
    if (stored === "on" || stored === "off") return stored === "on"
    return window.matchMedia("(min-width: 768px)").matches
  }

  let showMinimap = initialMinimapVisible()

  function setMinimap(pressed: boolean) {
    showMinimap = pressed
    window.localStorage.setItem("minimap", pressed ? "on" : "off")
  }
  $: {
    document.documentElement.classList.toggle("dark", dark)
    window.localStorage.setItem("theme", dark ? "dark" : "light")
    if ($terminal) {
      $terminal.options.theme = {
        ...$terminal.options.theme,
        background: dark ? "#252525" : "#ffffff",
        foreground: dark ? "#fafafa" : "#252525",
      }
    }
  }

  let unlistenUserSerial: UnlistenFn | undefined

  let dragNode: DragData | null = null

  const decoder = new TextDecoder("UTF-8")
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
  }
  const edgeTypes = {
    data: DataEdge,
    adi: AdiEdge,
  }

  onMount(async () => {
    unlistenUserSerial = await listen<number[]>("brain_usb_recv", (event) => {
      $terminal?.write(decoder.decode(new Uint8Array(event.payload)))
    })
  })

  onDestroy(() => {
    $session?.stop()
    unlistenUserSerial?.()
  })

  function handleWindowKeyDown({ key, ctrlKey, metaKey }: KeyboardEvent) {
    const ctrlOrMeta = ctrlKey || metaKey

    if (ctrlOrMeta && key == "r") {
      $session?.reset()
    }
  }
</script>

<svelte:window on:keydown={handleWindowKeyDown} />

<SidebarUI.Provider class="h-full min-h-0">
  <SvelteFlowProvider>
    <div
      class="split-view flex h-full w-full [&_.button.small.draggable-device]:w-full [&_.button.small.draggable-device]:justify-start [&_.button.small.draggable-device]:gap-2 [&_.button.small.draggable-device]:bg-muted [&_.button.small.draggable-device]:text-sm [&_.button.small.draggable-device]:tracking-normal [&_.button.small.draggable-device]:text-foreground [&_.button.small.draggable-device]:normal-case [&_.ports-bottom]:bottom-1 [&_.ports-bottom_.smart-port-label]:-top-9 [&_.ports-top]:top-1 [&_.ports-top_.smart-port-label]:-bottom-9 [&_.svelte-flow]:[--xy-background-color:var(--background)]! [&_.svelte-flow]:[--xy-background-pattern-color:var(--border)]! [&_.svelte-flow]:[--xy-connectionline-stroke:var(--primary)]! [&_.svelte-flow]:[--xy-controls-box-shadow:0_0_2px_1px_rgba(0,0,0,0.08)]! [&_.svelte-flow]:[--xy-controls-button-background-color-hover:var(--accent)]! [&_.svelte-flow]:[--xy-controls-button-background-color:var(--secondary)]! [&_.svelte-flow]:[--xy-controls-button-border-color:var(--accent)]! [&_.svelte-flow]:[--xy-controls-button-color-hover:var(--foreground)]! [&_.svelte-flow]:[--xy-controls-button-color:var(--foreground)]! [&_.svelte-flow]:[--xy-edge-label-background-color:#ffffff]! [&_.svelte-flow]:[--xy-edge-label-color:inherit]! [&_.svelte-flow]:[--xy-edge-stroke-selected:var(--primary)]! [&_.svelte-flow]:[--xy-edge-stroke-width:3px]! [&_.svelte-flow]:[--xy-edge-stroke:color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow]:[--xy-handle-background-color:var(--muted)]! [&_.svelte-flow]:[--xy-handle-border-color:color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow]:[--xy-minimap-background-color:var(--card)]! [&_.svelte-flow]:[--xy-minimap-mask-background-color:var(--muted)]! [&_.svelte-flow]:[--xy-minimap-node-background-color:var(--secondary)]! [&_.svelte-flow]:[--xy-node-background-color:var(--muted)]! [&_.svelte-flow]:[--xy-node-border-radius:4px]! [&_.svelte-flow]:[--xy-node-border:none]! [&_.svelte-flow]:[--xy-node-boxshadow-hover:0_1px_4px_1px_rgba(0,0,0,0.08)]! [&_.svelte-flow]:[--xy-node-boxshadow-selected:0_0_0_2px_color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow]:[--xy-node-color:var(--foreground)]! [&_.svelte-flow]:[--xy-node-group-background-color:rgba(240,240,240,0.25)]! [&_.svelte-flow]:[--xy-resize-background-color:var(--primary)]! [&_.svelte-flow]:[--xy-selection-background-color:oklch(from_var(--primary)_l_c_h/0.15)]! [&_.svelte-flow]:[--xy-selection-border:1px_solid_color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow\_\_attribution]:bg-card! [&_.svelte-flow\_\_attribution]:text-foreground! [&_.svelte-flow\_\_background_rect]:opacity-40! [&_.svelte-flow\_\_edge]:[--xy-background-color:var(--background)]! [&_.svelte-flow\_\_edge]:[--xy-background-pattern-color:var(--border)]! [&_.svelte-flow\_\_edge]:[--xy-connectionline-stroke:var(--primary)]! [&_.svelte-flow\_\_edge]:[--xy-controls-box-shadow:0_0_2px_1px_rgba(0,0,0,0.08)]! [&_.svelte-flow\_\_edge]:[--xy-controls-button-background-color-hover:var(--accent)]! [&_.svelte-flow\_\_edge]:[--xy-controls-button-background-color:var(--secondary)]! [&_.svelte-flow\_\_edge]:[--xy-controls-button-border-color:var(--accent)]! [&_.svelte-flow\_\_edge]:[--xy-controls-button-color-hover:var(--foreground)]! [&_.svelte-flow\_\_edge]:[--xy-controls-button-color:var(--foreground)]! [&_.svelte-flow\_\_edge]:[--xy-edge-label-background-color:#ffffff]! [&_.svelte-flow\_\_edge]:[--xy-edge-label-color:inherit]! [&_.svelte-flow\_\_edge]:[--xy-edge-stroke-selected:var(--primary)]! [&_.svelte-flow\_\_edge]:[--xy-edge-stroke-width:3px]! [&_.svelte-flow\_\_edge]:[--xy-edge-stroke:color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow\_\_edge]:[--xy-handle-background-color:var(--muted)]! [&_.svelte-flow\_\_edge]:[--xy-handle-border-color:color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow\_\_edge]:[--xy-minimap-background-color:var(--card)]! [&_.svelte-flow\_\_edge]:[--xy-minimap-mask-background-color:var(--muted)]! [&_.svelte-flow\_\_edge]:[--xy-minimap-node-background-color:var(--secondary)]! [&_.svelte-flow\_\_edge]:[--xy-node-background-color:var(--muted)]! [&_.svelte-flow\_\_edge]:[--xy-node-border-radius:4px]! [&_.svelte-flow\_\_edge]:[--xy-node-border:none]! [&_.svelte-flow\_\_edge]:[--xy-node-boxshadow-hover:0_1px_4px_1px_rgba(0,0,0,0.08)]! [&_.svelte-flow\_\_edge]:[--xy-node-boxshadow-selected:0_0_0_2px_color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow\_\_edge]:[--xy-node-color:var(--foreground)]! [&_.svelte-flow\_\_edge]:[--xy-node-group-background-color:rgba(240,240,240,0.25)]! [&_.svelte-flow\_\_edge]:[--xy-resize-background-color:var(--primary)]! [&_.svelte-flow\_\_edge]:[--xy-selection-background-color:oklch(from_var(--primary)_l_c_h/0.15)]! [&_.svelte-flow\_\_edge]:[--xy-selection-border:1px_solid_color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow\_\_edge:has(.adi-edge)]:[--ui-hue:var(--adi-hue)]! [&_.svelte-flow\_\_edge:has(.data-edge)]:[--ui-hue:var(--data-hue)]! [&_.svelte-flow\_\_handle]:h-2.5! [&_.svelte-flow\_\_handle]:w-2.5! [&_.svelte-flow\_\_handle]:rounded-full! [&_.svelte-flow\_\_handle]:transition-[border-color]! [&_.svelte-flow\_\_handle]:duration-150! [&_.svelte-flow\_\_handle]:ease-[ease]! [&_.svelte-flow\_\_handle]:[--xy-background-color:var(--background)]! [&_.svelte-flow\_\_handle]:[--xy-background-pattern-color:var(--border)]! [&_.svelte-flow\_\_handle]:[--xy-connectionline-stroke:var(--primary)]! [&_.svelte-flow\_\_handle]:[--xy-controls-box-shadow:0_0_2px_1px_rgba(0,0,0,0.08)]! [&_.svelte-flow\_\_handle]:[--xy-controls-button-background-color-hover:var(--accent)]! [&_.svelte-flow\_\_handle]:[--xy-controls-button-background-color:var(--secondary)]! [&_.svelte-flow\_\_handle]:[--xy-controls-button-border-color:var(--accent)]! [&_.svelte-flow\_\_handle]:[--xy-controls-button-color-hover:var(--foreground)]! [&_.svelte-flow\_\_handle]:[--xy-controls-button-color:var(--foreground)]! [&_.svelte-flow\_\_handle]:[--xy-edge-label-background-color:#ffffff]! [&_.svelte-flow\_\_handle]:[--xy-edge-label-color:inherit]! [&_.svelte-flow\_\_handle]:[--xy-edge-stroke-selected:var(--primary)]! [&_.svelte-flow\_\_handle]:[--xy-edge-stroke-width:3px]! [&_.svelte-flow\_\_handle]:[--xy-edge-stroke:color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow\_\_handle]:[--xy-handle-background-color:var(--muted)]! [&_.svelte-flow\_\_handle]:[--xy-handle-border-color:color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow\_\_handle]:[--xy-minimap-background-color:var(--card)]! [&_.svelte-flow\_\_handle]:[--xy-minimap-mask-background-color:var(--muted)]! [&_.svelte-flow\_\_handle]:[--xy-minimap-node-background-color:var(--secondary)]! [&_.svelte-flow\_\_handle]:[--xy-node-background-color:var(--muted)]! [&_.svelte-flow\_\_handle]:[--xy-node-border-radius:4px]! [&_.svelte-flow\_\_handle]:[--xy-node-border:none]! [&_.svelte-flow\_\_handle]:[--xy-node-boxshadow-hover:0_1px_4px_1px_rgba(0,0,0,0.08)]! [&_.svelte-flow\_\_handle]:[--xy-node-boxshadow-selected:0_0_0_2px_color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow\_\_handle]:[--xy-node-color:var(--foreground)]! [&_.svelte-flow\_\_handle]:[--xy-node-group-background-color:rgba(240,240,240,0.25)]! [&_.svelte-flow\_\_handle]:[--xy-resize-background-color:var(--primary)]! [&_.svelte-flow\_\_handle]:[--xy-selection-background-color:oklch(from_var(--primary)_l_c_h/0.15)]! [&_.svelte-flow\_\_handle]:[--xy-selection-border:1px_solid_color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow\_\_handle.adi-port-handle]:[--ui-hue:var(--adi-hue)]! [&_.svelte-flow\_\_handle.data-handle]:[--ui-hue:var(--data-hue)]! [&_.svelte-flow\_\_minimap]:overflow-hidden! [&_.svelte-flow\_\_minimap]:rounded! [&_.svelte-flow\_\_minimap]:opacity-80! [&_.svelte-flow\_\_minimap]:[box-shadow:0_4px_8px_rgba(0,0,0,0.25)]! [&_.svelte-flow\_\_minimap]:[backdrop-filter:blur(10px)]! [&_.svelte-flow\_\_minimap]:transition-all! [&_.svelte-flow\_\_minimap]:duration-150! [&_.svelte-flow\_\_minimap]:ease-[ease]! [&_.svelte-flow\_\_minimap]:[-webkit-backdrop-filter:blur(10px)]! [&_.svelte-flow\_\_minimap:hover]:opacity-100! [&_.svelte-flow\_\_node]:flex! [&_.svelte-flow\_\_node]:flex-col! [&_.svelte-flow\_\_node]:items-center! [&_.svelte-flow\_\_node]:justify-center! [&_.svelte-flow\_\_node]:rounded-xl! [&_.svelte-flow\_\_node]:border! [&_.svelte-flow\_\_node]:border-secondary! [&_.svelte-flow\_\_node]:bg-muted! [&_.svelte-flow\_\_node]:text-sm! [&_.svelte-flow\_\_node]:font-semibold! [&_.svelte-flow\_\_node]:text-foreground! [&_.svelte-flow\_\_node]:transition-[border-color,box-shadow]! [&_.svelte-flow\_\_node]:duration-150! [&_.svelte-flow\_\_node]:ease-[ease]! [&_.svelte-flow\_\_node]:[--xy-background-color:var(--background)]! [&_.svelte-flow\_\_node]:[--xy-background-pattern-color:var(--border)]! [&_.svelte-flow\_\_node]:[--xy-connectionline-stroke:var(--primary)]! [&_.svelte-flow\_\_node]:[--xy-controls-box-shadow:0_0_2px_1px_rgba(0,0,0,0.08)]! [&_.svelte-flow\_\_node]:[--xy-controls-button-background-color-hover:var(--accent)]! [&_.svelte-flow\_\_node]:[--xy-controls-button-background-color:var(--secondary)]! [&_.svelte-flow\_\_node]:[--xy-controls-button-border-color:var(--accent)]! [&_.svelte-flow\_\_node]:[--xy-controls-button-color-hover:var(--foreground)]! [&_.svelte-flow\_\_node]:[--xy-controls-button-color:var(--foreground)]! [&_.svelte-flow\_\_node]:[--xy-edge-label-background-color:#ffffff]! [&_.svelte-flow\_\_node]:[--xy-edge-label-color:inherit]! [&_.svelte-flow\_\_node]:[--xy-edge-stroke-selected:var(--primary)]! [&_.svelte-flow\_\_node]:[--xy-edge-stroke-width:3px]! [&_.svelte-flow\_\_node]:[--xy-edge-stroke:color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow\_\_node]:[--xy-handle-background-color:var(--muted)]! [&_.svelte-flow\_\_node]:[--xy-handle-border-color:color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow\_\_node]:[--xy-minimap-background-color:var(--card)]! [&_.svelte-flow\_\_node]:[--xy-minimap-mask-background-color:var(--muted)]! [&_.svelte-flow\_\_node]:[--xy-minimap-node-background-color:var(--secondary)]! [&_.svelte-flow\_\_node]:[--xy-node-background-color:var(--muted)]! [&_.svelte-flow\_\_node]:[--xy-node-border-radius:4px]! [&_.svelte-flow\_\_node]:[--xy-node-border:none]! [&_.svelte-flow\_\_node]:[--xy-node-boxshadow-hover:0_1px_4px_1px_rgba(0,0,0,0.08)]! [&_.svelte-flow\_\_node]:[--xy-node-boxshadow-selected:0_0_0_2px_color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow\_\_node]:[--xy-node-color:var(--foreground)]! [&_.svelte-flow\_\_node]:[--xy-node-group-background-color:rgba(240,240,240,0.25)]! [&_.svelte-flow\_\_node]:[--xy-resize-background-color:var(--primary)]! [&_.svelte-flow\_\_node]:[--xy-selection-background-color:oklch(from_var(--primary)_l_c_h/0.15)]! [&_.svelte-flow\_\_node]:[--xy-selection-border:1px_solid_color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow\_\_node-brain_.battery-port]:-z-1! [&_.svelte-flow\_\_node-brain_.battery-port]:h-6! [&_.svelte-flow\_\_node-brain_.battery-port]:w-1.5! [&_.svelte-flow\_\_node-brain_.battery-port]:transform-[translateX(100%)]! [&_.svelte-flow\_\_node-brain_.battery-port]:rounded-l-none! [&_.svelte-flow\_\_node-brain_.battery-port]:rounded-r! [&_.svelte-flow\_\_node-brain_.battery-port]:border-l-0! [&_.svelte-flow\_\_node-brain_.battery-port]:border-inherit! [&_.svelte-flow\_\_node-brain_.battery-port]:bg-card! [&_.svelte-flow\_\_node-brain_.battery-port]:transition-all! [&_.svelte-flow\_\_node-brain_.battery-port]:duration-150! [&_.svelte-flow\_\_node-brain_.battery-port]:ease-[ease]! [&_.svelte-flow\_\_node-brain_.display]:rounded! [&_.svelte-flow\_\_node-brain_.display]:border! [&_.svelte-flow\_\_node-brain_.display]:border-secondary! [&_.svelte-flow\_\_node-brain.selected_.battery-port]:[box-shadow:0_0_0_2px_color-mix(in_oklch,var(--primary),transparent_50%),0_0_0_2px_var(--card)]! [&_.svelte-flow\_\_node-brain:focus-visible_.battery-port]:[box-shadow:0_0_0_2px_color-mix(in_oklch,var(--primary),transparent_50%),0_0_0_2px_var(--card)]! [&_.svelte-flow\_\_node-light\_sensor]:[--ui-hue:var(--adi-hue)]! [&_.svelte-flow\_\_node-math]:[--ui-hue:var(--data-hue)]! [&_.svelte-flow\_\_node-motor]:rounded-none! [&_.svelte-flow\_\_node-motor]:border-0! [&_.svelte-flow\_\_node-motor]:bg-transparent! [&_.svelte-flow\_\_node-motor]:p-0! [&_.svelte-flow\_\_node-motor]:shadow-none! [&_.svelte-flow\_\_node-motor:hover]:border-0! [&_.svelte-flow\_\_node-time]:[--ui-hue:var(--data-hue)]! [&_.svelte-flow\_\_node-value]:[--ui-hue:var(--data-hue)]! [&_.svelte-flow\_\_node.selected]:[box-shadow:var(--xy-node-boxshadow-selected)]! [&_.svelte-flow\_\_node.selected]:[--xy-handle-border-color:color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow\_\_node.svelte-flow\_\_node-brain]:h-112.5! [&_.svelte-flow\_\_node.svelte-flow\_\_node-brain]:w-164.5! [&_.svelte-flow\_\_node.svelte-flow\_\_node-brain]:rounded-[60px]! [&_.svelte-flow\_\_node.svelte-flow\_\_node-brain]:border! [&_.svelte-flow\_\_node.svelte-flow\_\_node-brain]:border-border! [&_.svelte-flow\_\_node.svelte-flow\_\_node-brain]:bg-card! [&_.svelte-flow\_\_node:focus-visible]:[box-shadow:var(--xy-node-boxshadow-selected)]! [&_.svelte-flow\_\_node:focus-visible]:[--xy-handle-border-color:color-mix(in_oklch,var(--primary),transparent_50%)]! [&_.svelte-flow\_\_node:hover]:border-accent! [&_.svelte-flow\_\_selection]:rounded-[8px]! [&_summary::-webkit-details-marker]:hidden [&:has(.drag-item)_*]:cursor-grabbing!"
    >
      <DragNDropOverlay bind:dragNode {nodeTypes} />
      <Sidebar
        on:nodeGrab={(e) => {
          dragNode = e.detail
        }}
      />
      <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar">
        <Toolbar>
          <svelte:fragment slot="left">
            <SidebarUI.Trigger title="Toggle sidebar" />
            <IconButton
              variant="ghost"
              size="icon"
              title={($session?.paused ? "Unpause" : "Pause") + " execution"}
              disabled={!$session?.running || desktop}
              onclick={() => $session?.togglePause()}
            >
              <svelte:component
                this={$session?.paused ? Play : Pause}
                size="16"
              />
            </IconButton>
            <IconButton
              variant="ghost"
              size="icon"
              title="Reset program"
              disabled={!$session?.running}
              onclick={() => $session?.reset()}
            >
              <RefreshCw size="16" />
            </IconButton>
            <IconButton
              variant="ghost"
              size="icon"
              title="Unload program"
              disabled={!$session?.running}
              onclick={() => {
                $session?.stop()
                $session = null
              }}
            >
              <Power size="16" />
            </IconButton>
          </svelte:fragment>
          <svelte:fragment slot="right">
            <Toggle
              pressed={showMinimap}
              onPressedChange={setMinimap}
              size="default"
              class="size-7 px-0"
              title={showMinimap ? "Hide minimap" : "Show minimap"}
              aria-label={showMinimap ? "Hide minimap" : "Show minimap"}
            >
              <Map />
            </Toggle>
            <IconButton
              variant="ghost"
              size="icon"
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              onclick={() => (dark = !dark)}
            >
              {#if dark}
                <Sun />
              {:else}
                <Moon />
              {/if}
            </IconButton>
          </svelte:fragment>
        </Toolbar>
        <SidebarUI.Inset
          class="min-h-0 min-w-0 overflow-hidden md:m-2 md:mt-0 md:ml-0 md:rounded-xl md:shadow-sm"
        >
          <div
            class="app-left relative flex min-h-0 flex-auto flex-col overflow-hidden bg-background"
          >
            <section
              class="display-view relative flex min-h-0 flex-auto items-center-safe justify-center overflow-auto bg-[linear-gradient(var(--card)_1px,transparent_1px),linear-gradient(90deg,var(--card)_1px,transparent_1px)] bg-size-[20px_20px] bg-position-[-1px_-1px]"
              role="application"
            >
              <Flow {nodeTypes} {edgeTypes} {nodes} {edges} {showMinimap} />
            </section>
            <Terminal />
          </div>
        </SidebarUI.Inset>
      </div>
    </div>
  </SvelteFlowProvider>
</SidebarUI.Provider>
