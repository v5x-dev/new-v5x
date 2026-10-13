<script lang="ts">
  import {
    type NodeProps,
    type Node,
    Handle,
    Position,
    useSvelteFlow,
  } from "@xyflow/svelte"
  import { Battery } from "svelte-feathers"
  import { Field, NodeBase } from "~/lib/components"
  import { Input } from "~/lib/components/ui/input"

  type NodeData = {
    capacity: number
    temperature: number
    current: number
    voltage: number
  }

  type $$Props = NodeProps<Node<NodeData>>

  export let data: NodeData
  export let id: $$Props["id"]
  let capacity = data.capacity
  let temperature = data.temperature
  let current = data.current
  let voltage = data.voltage
  $: capacity = Math.max(0, Math.min(100, capacity))
  const { updateNodeData } = useSvelteFlow()
  $: updateNodeData(id, { capacity, temperature, current, voltage })
</script>

<NodeBase class="battery-node min-w-50" title="Battery">
  <Handle
    slot="handle"
    id="connector"
    type="source"
    isConnectable={false}
    position={Position.Left}
  />
  <Battery slot="icon" size="16" />

  <Field label="Capacity (%)">
    <Input
      type="number"
      class="nodrag w-20"
      min={0}
      max={100}
      bind:value={capacity}
    />
  </Field>
  <Field label="Temperature (°C)">
    <Input
      type="number"
      class="nodrag w-20"
      min={-40}
      max={100}
      bind:value={temperature}
    />
  </Field>
  <Field label="Current (mA)">
    <Input
      type="number"
      class="nodrag w-20"
      min={0}
      max={100000}
      bind:value={current}
    />
  </Field>
  <Field label="Voltage (mV)">
    <Input
      type="number"
      class="nodrag w-20"
      min={0}
      max={16000}
      bind:value={voltage}
    />
  </Field>
</NodeBase>
