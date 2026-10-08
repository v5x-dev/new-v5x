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
  import * as Tabs from "~/lib/components/ui/tabs"

  import { desktop, request } from "~/lib/runtime"
  import { session } from "~/lib/stores"
  let error = ""
  $: if (!desktop && $session?.running) {
    request("battery", new Blob([JSON.stringify({ capacity })]))
      .then(() => {
        error = ""
      })
      .catch((reason) => (error = String(reason)))
  }

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
  let batteryTab = "manual"
  $: capacity = Math.max(0, Math.min(100, capacity))
  const { updateNodeData } = useSvelteFlow()
  $: updateNodeData(id, { capacity })
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

  {#if error}<p role="alert">{error}</p>{/if}
  <Tabs.Root bind:value={batteryTab} class="gap-2">
    <Tabs.List class="w-full">
      <Tabs.Trigger value="auto" class="flex-1">Auto</Tabs.Trigger>
      <Tabs.Trigger value="manual" class="flex-1">Manual</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="auto" class="flex flex-col gap-2">TODO</Tabs.Content>
    <Tabs.Content value="manual" class="flex flex-col gap-2">
      <Field label="Capacity">
        <Input
          type="number"
          class="nodrag w-20"
          min={0}
          max={100}
          bind:value={capacity}
        />
      </Field>
      <Field label="Temperature">
        <Input
          type="number"
          class="nodrag w-20"
          bind:value={data.temperature}
        />
      </Field>
      <Field label="Current">
        <Input type="number" class="nodrag w-20" bind:value={data.current} />
      </Field>
      <Field label="Voltage">
        <Input type="number" class="nodrag w-20" bind:value={data.voltage} />
      </Field>
    </Tabs.Content>
  </Tabs.Root>
</NodeBase>
