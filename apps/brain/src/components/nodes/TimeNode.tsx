import { Position, type Node, type NodeProps } from "@xyflow/react"
import { useEffect, useRef, useState } from "react"
import { Clock } from "react-feather"
import { Field } from "~/components/Field"
import { DataHandle } from "~/components/handles"
import { NodeBase } from "~/components/NodeBase"
import { NodeNumberInput } from "~/components/NodeNumberInput"
import { NumberDisplay } from "~/components/NumberDisplay"
import { Switch } from "~/components/ui/switch"
import { clamp } from "~/lib/clamp"
import { updateNodeData } from "~/lib/stores"

type TimeData = {
  value?: number
  updateRate?: number
  advanced?: boolean
}

export function TimeNode({ id, data }: NodeProps<Node<TimeData>>) {
  const updateRate = clamp(1, 1000, data.updateRate ?? 60)
  const advanced = data.advanced ?? false

  const start = useRef(performance.now() / 1000)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(performance.now() / 1000 - start.current)
    }, 16)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      updateNodeData(id, { value: performance.now() / 1000 - start.current })
    }, 1000 / updateRate)
    return () => clearInterval(interval)
  }, [id, updateRate])

  useEffect(() => {
    updateNodeData(id, { updateRate, advanced })
  }, [id, updateRate, advanced])

  return (
    <NodeBase
      title="Time"
      icon={<Clock size="16" />}
      handle={<DataHandle id="output" position={Position.Left} type="source" />}
    >
      <Field label="Seconds">
        <NumberDisplay value={elapsed} />
      </Field>
      <Field label="Advanced">
        <Switch
          className="nodrag"
          checked={advanced}
          onCheckedChange={(checked) =>
            updateNodeData(id, { advanced: checked })
          }
        />
      </Field>
      {advanced && (
        <Field label="Update Rate (Hz)">
          <NodeNumberInput
            className="nodrag w-20"
            min={1}
            max={1000}
            value={updateRate}
            onValueChange={(next) =>
              updateNodeData(id, { updateRate: clamp(1, 1000, next) })
            }
          />
        </Field>
      )}
    </NodeBase>
  )
}
