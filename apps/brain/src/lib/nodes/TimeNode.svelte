<script lang="ts">
  import {
    type NodeProps,
    type Node,
    Position,
    useSvelteFlow,
  } from "@xyflow/svelte"
  import { Field, NodeBase, NumberDisplay } from "~/lib/components"
  import { Input } from "~/lib/components/ui/input"
  import { Switch } from "~/lib/components/ui/switch"
  import { DataHandle } from "~/lib/handles"
  import { Clock, Hash } from "svelte-feathers"
  import { onDestroy, onMount } from "svelte"

  type NodeData = {
    value: number
  }

  type $$Props = NodeProps<Node<NodeData>>

  export let data: NodeData
  export let id: $$Props["id"]

  const { updateNodeData } = useSvelteFlow()

  let start: number
  let now: number

  const { setInterval, clearInterval } = window

  let updateRate = 60
  $: updateRate = Math.max(1, Math.min(1000, updateRate))

  let timeInterval: number | undefined
  let updateInterval: number | undefined

  onMount(() => {
    start = performance.now() / 1000

    timeInterval = setInterval(() => {
      now = performance.now() / 1000
    }, 1)
    updateInterval = setInterval(() => {
      updateNodeData(id, { value: now - start })
    }, 1000 / updateRate)
  })

  function updateRateChanged(newRate: number) {
    if (updateInterval && newRate) {
      clearInterval(updateInterval)
      updateRate = newRate
      updateInterval = setInterval(() => {
        updateNodeData(id, { value: now - start })
      }, 1000 / newRate)
    }
  }
  $: updateRateChanged(updateRate)

  onDestroy(() => {
    clearInterval(timeInterval)
    clearInterval(updateInterval)
  })

  let advanced = false

  void data
</script>

<NodeBase title="Time">
  <Clock slot="icon" size="16" />
  <DataHandle
    slot="handle"
    id="output"
    position={Position.Left}
    type="source"
    parentNode={id}
  />
  <Field label="Seconds"><NumberDisplay value={now - start} /></Field>
  <Field label="Advanced"
    ><Switch bind:checked={advanced} class="nodrag" /></Field
  >
  {#if advanced}
    <Field label="Update Rate (Hz)">
      <Input
        type="number"
        class="nodrag w-20"
        min={1}
        max={1000}
        bind:value={updateRate}
      />
    </Field>
  {/if}
</NodeBase>
