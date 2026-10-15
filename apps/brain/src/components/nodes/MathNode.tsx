import { Position, type Node, type NodeProps } from "@xyflow/react"
import { useEffect } from "react"
import { PlusCircle } from "react-feather"
import { Field } from "~/components/Field"
import { DataHandle } from "~/components/handles"
import { NodeBase } from "~/components/NodeBase"
import { NodeNumberInput } from "~/components/NodeNumberInput"
import { NumberDisplay } from "~/components/NumberDisplay"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { useHandleConnections, useNodesData } from "~/lib/flow-hooks"
import { updateNodeData } from "~/lib/stores"

type MathData = {
  value?: number
  lhs?: number
  rhs?: number
  operation?: string
  currentTab?: string
}

const binaryOps = [
  { value: "add", label: "Addition" },
  { value: "sub", label: "Subtraction" },
  { value: "mul", label: "Multiplication" },
  { value: "div", label: "Division" },
]
const unaryOps = [
  { value: "neg", label: "Negation" },
  { value: "abs", label: "Absolute Value" },
  { value: "sqrt", label: "Square Root" },
  { value: "sin", label: "Sine" },
  { value: "cos", label: "Cosine" },
  { value: "tan", label: "Tangent" },
]

function compute(operation: string, lhs: number, rhs: number) {
  switch (operation) {
    case "add":
      return lhs + rhs
    case "sub":
      return lhs - rhs
    case "mul":
      return lhs * rhs
    case "div":
      return lhs / rhs
    case "neg":
      return -lhs
    case "abs":
      return Math.abs(lhs)
    case "sqrt":
      return Math.sqrt(lhs)
    case "sin":
      return Math.sin(lhs)
    case "cos":
      return Math.cos(lhs)
    case "tan":
      return Math.tan(lhs)
    default:
      return 0
  }
}

function OperationSelect({
  options,
  value,
  onValueChange,
}: {
  options: { value: string; label: string }[]
  value: string
  onValueChange: (value: string) => void
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => next && onValueChange(next)}
      items={options}
    >
      <SelectTrigger aria-label="Operation" className="nodrag w-full">
        <SelectValue placeholder="Select option" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function MathNode({ id, data }: NodeProps<Node<MathData>>) {
  const currentTab = data.currentTab ?? "binary"
  const options = currentTab === "binary" ? binaryOps : unaryOps
  const requested = data.operation ?? binaryOps[0]!.value
  const operation = options.some((option) => option.value === requested)
    ? requested
    : options[0]!.value
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
  const lhsSource = useNodesData(lhsConnections[0]?.source)
  const rhsSource = useNodesData(rhsConnections[0]?.source)
  // A connected input follows its source; the node data keeps the last value.
  const lhs = (lhsSource?.data.value as number | undefined) ?? data.lhs ?? 0
  const rhs = (rhsSource?.data.value as number | undefined) ?? data.rhs ?? 0
  const result = compute(operation, lhs, rhs)

  useEffect(() => {
    updateNodeData(id, { value: result, lhs, rhs, operation, currentTab })
  }, [id, result, lhs, rhs, operation, currentTab])

  const setOperation = (next: string) => updateNodeData(id, { operation: next })

  return (
    <NodeBase
      title="Math"
      icon={<PlusCircle size="16" />}
      handle={<DataHandle id="output" position={Position.Left} type="source" />}
    >
      <Tabs
        value={currentTab}
        onValueChange={(next) => updateNodeData(id, { currentTab: next })}
        className="gap-2"
      >
        <TabsList className="w-full">
          <TabsTrigger value="binary" className="flex-1">
            Binary
          </TabsTrigger>
          <TabsTrigger value="unary" className="flex-1">
            Unary
          </TabsTrigger>
        </TabsList>
        <TabsContent value="binary" className="flex flex-col gap-2">
          <OperationSelect
            options={binaryOps}
            value={operation}
            onValueChange={setOperation}
          />

          <Field
            label="LHS"
            handle={
              <DataHandle id="lhs" position={Position.Right} type="target" />
            }
          >
            <NodeNumberInput
              className="nodrag w-20"
              value={lhs}
              onValueChange={(next) => updateNodeData(id, { lhs: next })}
              disabled={lhsConnections.length > 0}
            />
          </Field>
          <Field
            label="RHS"
            handle={
              <DataHandle id="rhs" position={Position.Right} type="target" />
            }
          >
            <NodeNumberInput
              className="nodrag w-20"
              value={rhs}
              onValueChange={(next) => updateNodeData(id, { rhs: next })}
              disabled={rhsConnections.length > 0}
            />
          </Field>
        </TabsContent>
        <TabsContent value="unary" className="flex flex-col gap-2">
          <OperationSelect
            options={unaryOps}
            value={operation}
            onValueChange={setOperation}
          />

          <Field
            label="Input"
            handle={
              <DataHandle id="lhs" position={Position.Right} type="target" />
            }
          >
            <NodeNumberInput
              className="nodrag w-20"
              value={lhs}
              onValueChange={(next) => updateNodeData(id, { lhs: next })}
              disabled={lhsConnections.length > 0}
            />
          </Field>
        </TabsContent>
      </Tabs>

      <Field label="Result">
        <NumberDisplay value={result} decimals={3} />
      </Field>
    </NodeBase>
  )
}
