<script lang="ts">
  import { useHandleConnections, useNodesData } from "~/lib/flow-hooks.svelte"
  import {
    type NodeProps,
    type Node,
    Position,
    useSvelteFlow,
  } from "@xyflow/svelte"
  import { PlusCircle } from "svelte-feathers"
  import { Field, NodeBase, NumberDisplay } from "~/lib/components"
  import { Input } from "~/lib/components/ui/input"
  import * as Select from "~/lib/components/ui/select"
  import * as Tabs from "~/lib/components/ui/tabs"
  import { DataHandle } from "~/lib/handles"

  type NodeData = {
    value: number
  }

  type $$Props = NodeProps<Node<NodeData>>

  export let data: NodeData
  export let id: $$Props["id"]

  export let lhs = 0
  export let rhs = 0

  const binaryOps = [
    {
      value: "add",
      label: "Addition",
    },
    {
      value: "sub",
      label: "Subtraction",
    },
    {
      value: "mul",
      label: "Multiplication",
    },
    {
      value: "div",
      label: "Division",
    },
  ]
  const unaryOps = [
    {
      value: "neg",
      label: "Negation",
    },
    {
      value: "abs",
      label: "Absolute Value",
    },
    {
      value: "sqrt",
      label: "Square Root",
    },
    {
      value: "sin",
      label: "Sine",
    },
    {
      value: "cos",
      label: "Cosine",
    },
    {
      value: "tan",
      label: "Tangent",
    },
  ]
  let operation = binaryOps[0].value

  let result = 0
  $: {
    switch (operation) {
      case "add":
        result = lhs + rhs
        break
      case "sub":
        result = lhs - rhs
        break
      case "mul":
        result = lhs * rhs
        break
      case "div":
        result = lhs / rhs
        break
      case "neg":
        result = -lhs
        break
      case "abs":
        result = Math.abs(lhs)
        break
      case "sqrt":
        result = Math.sqrt(lhs)
        break
      case "sin":
        result = Math.sin(lhs)
        break
      case "cos":
        result = Math.cos(lhs)
        break
      case "tan":
        result = Math.tan(lhs)
        break
    }
  }

  let currentTab = "binary"

  $: {
    if (currentTab === "binary") {
      operation = binaryOps[0].value
    } else {
      operation = unaryOps[0].value
    }
  }

  const { updateNodeData } = useSvelteFlow()
  $: updateNodeData(id, { value: result })

  const lhsConnections = useHandleConnections({
    nodeId: id,
    type: "target",
    id: "data_lhs",
  })
  const rhsConnections = useHandleConnections({
    nodeId: id,
    type: "target",
    id: "data_rhs",
  })
  $: lhsData = useNodesData($lhsConnections[0]?.source)
  $: rhsData = useNodesData($rhsConnections[0]?.source)

  $: {
    if ($lhsData) {
      lhs = $lhsData.data.value as number
    }
    if ($rhsData) {
      rhs = $rhsData.data.value as number
    }
  }

  void data
</script>

<NodeBase title="Math">
  <PlusCircle slot="icon" size="16" />
  <DataHandle
    slot="handle"
    id="output"
    position={Position.Left}
    type="source"
    parentNode={id}
  />

  <Tabs.Root bind:value={currentTab} class="gap-2">
    <Tabs.List class="w-full">
      <Tabs.Trigger value="binary" class="flex-1">Binary</Tabs.Trigger>
      <Tabs.Trigger value="unary" class="flex-1">Unary</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="binary" class="flex flex-col gap-2">
      <Select.Root type="single" bind:value={operation}>
        <Select.Trigger aria-label="Operation" class="nodrag w-full">
          {binaryOps.find((option) => option.value === operation)?.label ??
            "Select option"}
        </Select.Trigger>
        <Select.Content>
          {#each binaryOps as option (option.value)}
            <Select.Item value={option.value} label={option.label}
              >{option.label}</Select.Item
            >
          {/each}
        </Select.Content>
      </Select.Root>

      <Field label="LHS">
        <DataHandle
          slot="handle"
          id="lhs"
          position={Position.Right}
          type="target"
          parentNode={id}
        />
        <Input
          type="number"
          class="nodrag w-20"
          bind:value={lhs}
          disabled={$lhsConnections.length > 0}
        />
      </Field>
      <Field label="RHS">
        <DataHandle
          slot="handle"
          id="rhs"
          position={Position.Right}
          type="target"
          parentNode={id}
        />
        <Input
          type="number"
          class="nodrag w-20"
          bind:value={rhs}
          disabled={$rhsConnections.length > 0}
        />
      </Field>
    </Tabs.Content>
    <Tabs.Content value="unary" class="flex flex-col gap-2">
      <Select.Root type="single" bind:value={operation}>
        <Select.Trigger aria-label="Operation" class="nodrag w-full">
          {unaryOps.find((option) => option.value === operation)?.label ??
            "Select option"}
        </Select.Trigger>
        <Select.Content>
          {#each unaryOps as option (option.value)}
            <Select.Item value={option.value} label={option.label}
              >{option.label}</Select.Item
            >
          {/each}
        </Select.Content>
      </Select.Root>

      <Field label="Input">
        <DataHandle
          slot="handle"
          id="lhs"
          position={Position.Right}
          type="target"
          parentNode={id}
        />
        <Input
          type="number"
          class="nodrag w-20"
          bind:value={lhs}
          disabled={$lhsConnections.length > 0}
        />
      </Field>
    </Tabs.Content>
  </Tabs.Root>

  <Field label="Result">
    <NumberDisplay value={result} decimals={3} />
  </Field>
</NodeBase>
