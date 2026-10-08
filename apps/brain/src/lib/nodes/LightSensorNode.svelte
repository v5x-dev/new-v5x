<script lang="ts">
  import { useHandleConnections, useNodesData } from "~/lib/flow-hooks.svelte"
  import { type NodeProps, type Node, Position } from "@xyflow/svelte"
  import { AdiPortHandle, DataHandle } from "~/lib/handles"
  import { Field, NodeBase } from "~/lib/components"
  import { Input } from "~/lib/components/ui/input"
  import { Slider } from "~/lib/components/ui/slider"
  import { LightSensor } from "~/lib/icons"

  type NodeData = {}

  type $$Props = NodeProps<Node<NodeData>>

  export let data: NodeData
  export let id: $$Props["id"]

  let brightness = 127
  $: brightness = Math.max(0, Math.min(255, brightness))

  const brightnessConnections = useHandleConnections({
    nodeId: id,
    type: "target",
    id: "data_distance",
  })
  $: distanceData = useNodesData($brightnessConnections[0]?.source)

  $: {
    if ($distanceData) {
      brightness = $distanceData.data.value as number
    }
  }

  void data
</script>

<NodeBase title="Light Sensor">
  <AdiPortHandle
    slot="handle"
    id="connector"
    type="source"
    parentNode={id}
    position={Position.Left}
  />
  <LightSensor slot="icon" size="16" />

  <Field label="Darkness">
    <DataHandle
      slot="handle"
      id="distance"
      position={Position.Right}
      type="target"
      parentNode={id}
    />
    <Input
      type="number"
      class="nodrag w-20"
      max={255}
      min={0}
      step={1}
      disabled={$brightnessConnections.length > 0}
      bind:value={brightness}
    />
  </Field>
  <Slider
    type="single"
    bind:value={brightness}
    min={0}
    max={255}
    step={1}
    disabled={false}
    aria-label="Darkness slider"
    class="nodrag min-w-24"
  />
</NodeBase>
