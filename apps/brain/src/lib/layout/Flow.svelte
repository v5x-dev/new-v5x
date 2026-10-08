<script lang="ts">
  import type { Writable } from "svelte/store"
  import {
    Background,
    BackgroundVariant,
    MiniMap,
    SvelteFlow,
    useSvelteFlow,
    type Edge,
    type Node,
    type NodeTypes,
    type EdgeTypes,
  } from "@xyflow/svelte"
  import FlowControls from "./FlowControls.svelte"

  const { screenToFlowPosition } = useSvelteFlow()

  export let nodeTypes: NodeTypes | undefined
  export let edgeTypes: EdgeTypes | undefined
  export let nodes: Writable<Node[]>
  export let edges: Writable<Edge[]>
  export let showMinimap = true
</script>

<SvelteFlow
  {nodeTypes}
  {edgeTypes}
  bind:nodes={$nodes}
  bind:edges={$edges}
  attributionPosition="top-right"
  fitView
  fitViewOptions={{ maxZoom: 1.0 }}
>
  <Background variant={BackgroundVariant.Lines} />
  <FlowControls />
  {#if showMinimap}
    <MiniMap />
  {/if}
</SvelteFlow>
