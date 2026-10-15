import { Position, type Node, type NodeProps } from "@xyflow/react"
import { Battery } from "react-feather"
import { Field } from "~/components/Field"
import { ConnectorHandle } from "~/components/handles"
import { NodeBase } from "~/components/NodeBase"
import { NodeNumberInput } from "~/components/NodeNumberInput"
import { clamp } from "~/lib/clamp"
import { updateNodeData } from "~/lib/stores"

type BatteryData = {
  capacity?: number
  temperature?: number
  current?: number
  voltage?: number
}

export function BatteryNode({ id, data }: NodeProps<Node<BatteryData>>) {
  const update = (values: BatteryData) => updateNodeData(id, values)

  return (
    <NodeBase
      className="battery-node min-w-50"
      title="Battery"
      handle={
        <ConnectorHandle
          id="connector"
          type="source"
          position={Position.Left}
        />
      }
      icon={<Battery size="16" />}
    >
      <Field label="Capacity (%)">
        <NodeNumberInput
          className="nodrag w-20"
          min={0}
          max={100}
          value={clamp(0, 100, data.capacity ?? 0)}
          onValueChange={(capacity) =>
            update({ capacity: clamp(0, 100, capacity) })
          }
        />
      </Field>
      <Field label="Temperature (°C)">
        <NodeNumberInput
          className="nodrag w-20"
          min={-40}
          max={100}
          value={data.temperature ?? 0}
          onValueChange={(temperature) => update({ temperature })}
        />
      </Field>
      <Field label="Current (mA)">
        <NodeNumberInput
          className="nodrag w-20"
          min={0}
          max={100000}
          value={data.current ?? 0}
          onValueChange={(current) => update({ current })}
        />
      </Field>
      <Field label="Voltage (mV)">
        <NodeNumberInput
          className="nodrag w-20"
          min={0}
          max={16000}
          value={data.voltage ?? 0}
          onValueChange={(voltage) => update({ voltage })}
        />
      </Field>
    </NodeBase>
  )
}
