<script lang="ts">
  import { useSvelteFlow, type Node, type NodeTypes } from "@xyflow/svelte"
  import type { DragData } from "../layout/Sidebar.svelte"
  import { nodes } from "../stores.js"
  import NodeBase from "./NodeBase.svelte"

  const { screenToFlowPosition } = useSvelteFlow()

  import { useViewport } from "~/lib/flow-hooks.svelte"
  const viewport = useViewport()

  export let dragNode: DragData | null = null
  export let nodeTypes: NodeTypes

  function overGrid(x: number, y: number) {
    return document.elementsFromPoint(x, y).some((element) => {
      return (
        element instanceof Element &&
        element.closest(".display-view") != null &&
        element.closest(".drag-overlay") == null
      )
    })
  }

  function handleNodeDrop(event: MouseEvent) {
    if (!dragNode) return

    if (overGrid(event.clientX, event.clientY)) {
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const headerOffset = -18
      position.y += headerOffset

      const newNode = {
        id: `${crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
        type: dragNode.nodeType,
        position,
        data: { label: `${dragNode.nodeType} node` },
        origin: [0.5, 0.0],
      } satisfies Node

      $nodes = [...$nodes, newNode]
    }

    dragNode = null
  }
</script>

<svelte:window
  on:mousemove={(e) => {
    if (dragNode) {
      dragNode.x = e.clientX
      dragNode.y = e.clientY
      dragNode.valid = overGrid(e.clientX, e.clientY)
    }
  }}
  on:mouseup={handleNodeDrop}
/>

<div
  class="drag-overlay pointer-events-none absolute inset-0 z-1000 overflow-hidden"
>
  {#if dragNode}
    <div
      class="drag-item svelte-flow__node pointer-events-none absolute z-1000 transform-[scale(var(--flow-zoom,1))_translate(-50%,calc(-36px/2))] [box-shadow:0_4px_8px_rgba(0,0,0,0.35)] [&.drag-item[data-valid='false']]:opacity-90! [&.drag-item[data-valid='false']]:grayscale-75! svelte-flow__node-{dragNode.nodeType} top-[attr(data-y_px)] left-[attr(data-x_px)] [--flow-zoom:attr(data-zoom_number)]"
      data-valid={dragNode.valid}
      data-x={dragNode.x}
      data-y={dragNode.y}
      data-zoom={$viewport.zoom}
    >
      <svelte:component
        this={nodeTypes[dragNode.nodeType] ?? NodeBase}
        id="drag-preview"
        type={dragNode.nodeType}
        selected={false}
        dragging={true}
        draggable={false}
        selectable={false}
        deletable={false}
        isConnectable={false}
        positionAbsoluteX={dragNode.x}
        positionAbsoluteY={dragNode.y}
        zIndex={1000}
        data={{}}
      />
    </div>
  {/if}
</div>

<style>
  /* xyflow sets pointer-events: all on .svelte-flow__node, which puts the
     preview under the cursor and makes the grid miss the drop. */
  .drag-overlay,
  .drag-overlay :global(*) {
    pointer-events: none !important;
  }
</style>
