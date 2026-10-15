import { Position, type Node, type NodeProps } from "@xyflow/react"
import { useEffect } from "react"
import { Hash } from "react-feather"
import { Field } from "~/components/Field"
import { DataHandle } from "~/components/handles"
import { NodeBase } from "~/components/NodeBase"
import { NodeNumberInput } from "~/components/NodeNumberInput"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { updateNodeData } from "~/lib/stores"

type ValueData = {
  value?: number
  currentTab?: string
  constant?: string
}

const constants = [
  { value: "pi", label: "π", amount: Math.PI },
  { value: "tao", label: "τ", amount: 2 * Math.PI },
  { value: "e", label: "e", amount: Math.E },
]

export function ValueNode({ id, data }: NodeProps<Node<ValueData>>) {
  const currentTab = data.currentTab ?? "value"
  const constant = data.constant ?? constants[0]!.value
  const value =
    currentTab === "constant"
      ? (constants.find((option) => option.value === constant)?.amount ??
        data.value ??
        0)
      : (data.value ?? 0)

  useEffect(() => {
    updateNodeData(id, { value, currentTab, constant })
  }, [id, value, currentTab, constant])

  return (
    <NodeBase
      title="Value"
      icon={<Hash size="16" />}
      handle={<DataHandle id="output" position={Position.Left} type="source" />}
    >
      <Tabs
        value={currentTab}
        onValueChange={(next) => updateNodeData(id, { currentTab: next })}
        className="gap-2"
      >
        <TabsList className="w-full">
          <TabsTrigger value="value" className="flex-1">
            Value
          </TabsTrigger>
          <TabsTrigger value="constant" className="flex-1">
            Constant
          </TabsTrigger>
        </TabsList>
        <TabsContent value="value" className="flex flex-col gap-2">
          <Field label="Value">
            <NodeNumberInput
              className="nodrag w-20"
              value={value}
              onValueChange={(next) => updateNodeData(id, { value: next })}
            />
          </Field>
        </TabsContent>
        <TabsContent value="constant" className="flex flex-col gap-2">
          <Field label="Constant">
            <Select
              value={constant}
              onValueChange={(next) => updateNodeData(id, { constant: next })}
              items={constants}
            >
              <SelectTrigger aria-label="Constant" className="nodrag w-full">
                <SelectValue placeholder="Select option" />
              </SelectTrigger>
              <SelectContent>
                {constants.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </TabsContent>
      </Tabs>
    </NodeBase>
  )
}
