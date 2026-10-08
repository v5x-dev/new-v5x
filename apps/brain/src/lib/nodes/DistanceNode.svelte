<script lang="ts">
  import { useHandleConnections, useNodesData } from "~/lib/flow-hooks.svelte"
  import { type NodeProps, type Node, Position } from "@xyflow/svelte"
  import { DataHandle, SmartPortHandle } from "~/lib/handles"
  import { Field, NodeBase, Divider } from "~/lib/components"
  import { Checkbox } from "~/lib/components/ui/checkbox"
  import { Input } from "~/lib/components/ui/input"
  import { Slider } from "~/lib/components/ui/slider"
  import { DistanceSensor } from "~/lib/icons"

  type NodeData = {}

  type $$Props = NodeProps<Node<NodeData>>

  export let data: NodeData
  export let id: $$Props["id"]

  let distance = 1000
  let size = 200
  $: distance = Math.max(20, Math.min(2000, distance))
  $: size = Math.max(0, Math.min(400, size))

  let objectVisible = true

  const distanceConnections = useHandleConnections({
    nodeId: id,
    type: "target",
    id: "data_distance",
  })
  const sizeConnections = useHandleConnections({
    nodeId: id,
    type: "target",
    id: "data_size",
  })
  $: distanceData = useNodesData($distanceConnections[0]?.source)
  $: sizeData = useNodesData($sizeConnections[0]?.source)

  $: {
    if ($distanceData) {
      distance = $distanceData.data.value as number
    }
    if ($sizeData) {
      size = $sizeData.data.value as number
    }
  }

  void data
</script>

<NodeBase title="Distance Sensor">
  <SmartPortHandle
    slot="handle"
    id="connector"
    type="source"
    parentNode={id}
    position={Position.Left}
  />
  <DistanceSensor slot="icon" size="16" />

  <Field label="Object Detected">
    <Checkbox bind:checked={objectVisible} class="nodrag" />
  </Field>
  <Divider />
  <Field label="Distance">
    <DataHandle
      slot="handle"
      id="distance"
      position={Position.Right}
      type="target"
      parentNode={id}
    />
    {#if objectVisible}<Input
        type="number"
        class="nodrag w-20"
        max={2000}
        min={20}
        step={10}
        disabled={!objectVisible && $distanceConnections.length > 0}
        bind:value={distance}
      />{:else}<Input
        type="number"
        class="nodrag w-20"
        disabled
        value={9999}
      />{/if}
  </Field>
  {#if objectVisible}
    <Slider
      type="single"
      bind:value={distance}
      disabled={!objectVisible}
      min={20}
      max={2000}
      step={10}
      aria-label="Distance slider"
      class="nodrag min-w-24"
    />
  {/if}
  <Field label="Size">
    <DataHandle
      slot="handle"
      id="size"
      position={Position.Right}
      type="target"
      parentNode={id}
    />
    {#if objectVisible}<Input
        type="number"
        class="nodrag w-20"
        max={400}
        min={0}
        step={10}
        disabled={!objectVisible && $sizeConnections.length > 0}
        bind:value={size}
      />{:else}<Input
        type="number"
        class="nodrag w-20"
        disabled
        value={-1}
      />{/if}
  </Field>
</NodeBase>
