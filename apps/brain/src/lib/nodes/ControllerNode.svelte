<script lang="ts">
  import {
    type NodeProps,
    type Node,
    Handle,
    Position,
    useSvelteFlow,
  } from "@xyflow/svelte"
  import Controller from "~/lib/icons/Controller.svelte"
  import { Field, NodeBase } from "~/lib/components"
  import { Button } from "~/lib/components/ui/button"
  import { Input } from "~/lib/components/ui/input"
  import { nodes } from "~/lib/stores"

  type NodeData = {
    controllerId?: number
    axis1?: number
    axis2?: number
    axis3?: number
    axis4?: number
    buttons?: number
    capacity?: number
    connected?: boolean
  }
  type $$Props = NodeProps<Node<NodeData>>

  export let data: NodeData
  export let id: $$Props["id"]

  const { updateNodeData } = useSvelteFlow()
  $: masterInUse = $nodes.some(
    (node) =>
      node.id !== id &&
      node.type === "controller" &&
      node.data.controllerId === 0,
  )
  $: partnerInUse = $nodes.some(
    (node) =>
      node.id !== id &&
      node.type === "controller" &&
      node.data.controllerId === 1,
  )
  const buttonInputs = [
    ["L1", 1],
    ["L2", 2],
    ["R1", 4],
    ["R2", 8],
    ["Up", 16],
    ["Down", 32],
    ["Left", 64],
    ["Right", 128],
    ["X", 256],
    ["B", 512],
    ["Y", 1024],
    ["A", 2048],
  ] as const

  function setValue(key: keyof NodeData, value: number | boolean) {
    updateNodeData(id, { [key]: value })
  }

  function toggleButton(mask: number) {
    const buttons = data.buttons ?? 0
    setValue("buttons", buttons & mask ? buttons & ~mask : buttons | mask)
  }

  function inputValue(event: Event, key: keyof NodeData) {
    const input = event.currentTarget as HTMLInputElement
    const value = input.valueAsNumber
    if (!Number.isFinite(value)) return
    const range: Record<string, [number, number]> = {
      axis1: [-127, 127],
      axis2: [-127, 127],
      axis3: [-127, 127],
      axis4: [-127, 127],
      capacity: [0, 100],
    }
    const [min, max] = range[key] ?? [
      Number.MIN_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    ]
    setValue(key, Math.max(min, Math.min(max, Math.round(value))))
  }
</script>

<NodeBase class="controller-node w-68" title="V5 Controller">
  <Handle
    slot="handle"
    id="connector"
    type="source"
    isConnectable={false}
    position={Position.Left}
  />
  <Controller slot="icon" size="16" />

  <div class="flex items-center gap-1 rounded-lg bg-muted p-1">
    <Button
      type="button"
      size="sm"
      class="flex-1"
      variant={(data.controllerId ?? 0) === 0 ? "secondary" : "ghost"}
      aria-pressed={(data.controllerId ?? 0) === 0}
      disabled={masterInUse}
      onclick={() => setValue("controllerId", 0)}>Master</Button
    >
    <Button
      type="button"
      size="sm"
      class="flex-1"
      variant={data.controllerId === 1 ? "secondary" : "ghost"}
      aria-pressed={data.controllerId === 1}
      disabled={partnerInUse}
      onclick={() => setValue("controllerId", 1)}>Partner</Button
    >
  </div>

  <div class="flex items-center justify-between border-b border-border/70 pb-2">
    <span class="text-xs text-muted-foreground">Wireless link</span>
    <Button
      type="button"
      size="sm"
      variant={data.connected ? "secondary" : "outline"}
      aria-pressed={data.connected === true}
      onclick={() => setValue("connected", data.connected !== true)}
    >
      <span
        class="size-2 rounded-full"
        class:bg-primary={data.connected}
        class:bg-muted-foreground={!data.connected}
      ></span>
      {data.connected ? "Connected" : "Disconnected"}
    </Button>
  </div>

  <div class="grid grid-cols-2 gap-2">
    {#each ["axis1", "axis2", "axis3", "axis4"] as axis, index}
      <Field label={"Axis " + (index + 1)} layout="vertical">
        <Input
          type="number"
          class="nodrag h-8 w-full text-right font-mono tabular-nums"
          min={-127}
          max={127}
          step={1}
          value={data[axis as keyof NodeData] ?? 0}
          oninput={(event) => inputValue(event, axis as keyof NodeData)}
        />
      </Field>
    {/each}
  </div>

  <div
    class="grid grid-cols-4 gap-1"
    role="group"
    aria-label="Controller buttons"
  >
    {#each buttonInputs as [label, mask]}
      <Button
        type="button"
        size="sm"
        class="min-w-0 px-1 font-mono"
        variant={(data.buttons ?? 0) & mask ? "secondary" : "outline"}
        aria-label={"Controller button " + label}
        aria-pressed={((data.buttons ?? 0) & mask) !== 0}
        onclick={() => toggleButton(mask)}>{label}</Button
      >
    {/each}
  </div>

  <Field label="Battery">
    <div class="flex items-center gap-2">
      <Input
        type="number"
        class="nodrag h-8 w-16 text-right font-mono tabular-nums"
        min={0}
        max={100}
        step={1}
        aria-label="Controller battery percentage"
        value={data.capacity ?? 100}
        oninput={(event) => inputValue(event, "capacity")}
      />
      <span class="text-xs text-muted-foreground">%</span>
      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          class="h-full rounded-full bg-primary"
          style={`width: ${data.capacity ?? 100}%`}
        ></div>
      </div>
    </div>
  </Field>
</NodeBase>
