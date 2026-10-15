import { Position, type Node, type NodeProps } from "@xyflow/react"
import { useEffect, useState } from "react"
import { Field } from "~/components/Field"
import { AdiPortHandle, DataHandle } from "~/components/handles"
import { LightSensor } from "~/components/icons"
import { NodeBase } from "~/components/NodeBase"
import { NodeNumberInput } from "~/components/NodeNumberInput"
import { Slider } from "~/components/ui/slider"
import { clamp } from "~/lib/clamp"
import { useHandleConnections, useNodesData } from "~/lib/flow-hooks"

export function LightSensorNode({ id }: NodeProps<Node>) {
  const [stored, setBrightness] = useState(127)

  const connections = useHandleConnections({
    nodeId: id,
    type: "target",
    id: "data_distance",
  })
  const source = useNodesData(connections[0]?.source)
  const linked = source?.data.value as number | undefined
  const brightness = linked === undefined ? stored : clamp(0, 255, linked)

  // Keep the last linked value once the wire is removed.
  useEffect(() => {
    if (linked !== undefined) setBrightness(clamp(0, 255, linked))
  }, [linked])

  return (
    <NodeBase
      title="Light Sensor"
      handle={
        <AdiPortHandle id="connector" type="source" position={Position.Left} />
      }
      icon={<LightSensor size="16" />}
    >
      <Field
        label="Darkness"
        handle={
          <DataHandle id="distance" position={Position.Right} type="target" />
        }
      >
        <NodeNumberInput
          className="nodrag w-20"
          max={255}
          min={0}
          step={1}
          disabled={connections.length > 0}
          value={brightness}
          onValueChange={(next) => setBrightness(clamp(0, 255, next))}
        />
      </Field>
      <Slider
        value={[brightness]}
        onValueChange={(value) =>
          setBrightness(Array.isArray(value) ? value[0]! : value)
        }
        min={0}
        max={255}
        step={1}
        disabled={false}
        aria-label="Darkness slider"
        className="nodrag min-w-24"
      />
    </NodeBase>
  )
}
