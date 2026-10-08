<script lang="ts">
  import {
    type NodeProps,
    type Node,
    Position,
    useSvelteFlow,
  } from "@xyflow/svelte"
  import { Field, NodeBase } from "~/lib/components"
  import { Input } from "~/lib/components/ui/input"
  import * as Select from "~/lib/components/ui/select"
  import * as Tabs from "~/lib/components/ui/tabs"
  import { DataHandle } from "~/lib/handles"
  import { Hash } from "svelte-feathers"

  type NodeData = {
    value: number
  }

  type $$Props = NodeProps<Node<NodeData>>

  export let data: NodeData
  export let id: $$Props["id"]

  let value = 0

  const { updateNodeData } = useSvelteFlow()
  $: updateNodeData(id, { value })

  let currentTab = "value"

  let constants = [
    { value: "pi", label: "π" },
    { value: "tao", label: "τ" },
    { value: "e", label: "e" },
  ]
  let constant = constants[0].value

  $: {
    if (currentTab === "constant") {
      switch (constant) {
        case "pi":
          value = Math.PI
          break
        case "tao":
          value = 2 * Math.PI
          break
        case "e":
          value = Math.E
          break
      }
    }
  }

  void data
</script>

<NodeBase title="Value">
  <Hash slot="icon" size="16" />
  <DataHandle
    slot="handle"
    id="output"
    position={Position.Left}
    type="source"
    parentNode={id}
  />
  <Tabs.Root bind:value={currentTab} class="gap-2">
    <Tabs.List class="w-full">
      <Tabs.Trigger value="value" class="flex-1">Value</Tabs.Trigger>
      <Tabs.Trigger value="constant" class="flex-1">Constant</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="value" class="flex flex-col gap-2">
      <Field label="Value">
        <Input type="number" class="nodrag w-20" bind:value />
      </Field>
    </Tabs.Content>
    <Tabs.Content value="constant" class="flex flex-col gap-2">
      <Field label="Constant">
        <Select.Root type="single" bind:value={constant}>
          <Select.Trigger aria-label="Constant" class="nodrag w-full">
            {constants.find((option) => option.value === constant)?.label ??
              "Select option"}
          </Select.Trigger>
          <Select.Content>
            {#each constants as option (option.value)}
              <Select.Item value={option.value} label={option.label}
                >{option.label}</Select.Item
              >
            {/each}
          </Select.Content>
        </Select.Root>
      </Field>
    </Tabs.Content>
  </Tabs.Root>
</NodeBase>
