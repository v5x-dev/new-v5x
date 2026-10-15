import { Position, type Node, type NodeProps } from "@xyflow/react"
import { useEffect } from "react"
import { Divider } from "~/components/Divider"
import { Field } from "~/components/Field"
import { DataHandle, SmartPortHandle } from "~/components/handles"
import { DistanceSensor } from "~/components/icons"
import { NodeBase } from "~/components/NodeBase"
import { NodeNumberInput } from "~/components/NodeNumberInput"
import { Checkbox } from "~/components/ui/checkbox"
import { Input } from "~/components/ui/input"
import { Slider } from "~/components/ui/slider"
import { clamp } from "~/lib/clamp"
import { useHandleConnections, useNodesData } from "~/lib/flow-hooks"
import { updateNodeData } from "~/lib/stores"

type DistanceData = {
  distance?: number
  size?: number
  objectVisible?: boolean
}

export function DistanceNode({ id, data }: NodeProps<Node<DistanceData>>) {
  const objectVisible = data.objectVisible ?? true

  const distanceConnections = useHandleConnections({
    nodeId: id,
    type: "target",
    id: "data_distance",
  })
  const sizeConnections = useHandleConnections({
    nodeId: id,
    type: "target",
    id: "data_size",
  })
  const distanceSource = useNodesData(distanceConnections[0]?.source)
  const sizeSource = useNodesData(sizeConnections[0]?.source)
  // A connected input follows its source; the node data keeps the last value.
  const distance = clamp(
    20,
    2000,
    (distanceSource?.data.value as number | undefined) ?? data.distance ?? 1000,
  )
  const size = clamp(
    0,
    400,
    (sizeSource?.data.value as number | undefined) ?? data.size ?? 200,
  )

  useEffect(() => {
    updateNodeData(id, { distance, size, objectVisible })
  }, [id, distance, size, objectVisible])

  const distanceLinked = distanceConnections.length > 0
  const sizeLinked = sizeConnections.length > 0

  return (
    <NodeBase
      title="Distance Sensor"
      handle={
        <SmartPortHandle
          id="connector"
          type="source"
          position={Position.Left}
        />
      }
      icon={<DistanceSensor size="16" />}
    >
      <Field label="Object Detected">
        <Checkbox
          className="nodrag"
          checked={objectVisible}
          onCheckedChange={(checked) =>
            updateNodeData(id, { objectVisible: checked })
          }
        />
      </Field>
      <Divider />
      <Field
        label="Distance"
        handle={
          <DataHandle id="distance" position={Position.Right} type="target" />
        }
      >
        {objectVisible ? (
          <NodeNumberInput
            className="nodrag w-20"
            max={2000}
            min={20}
            step={10}
            disabled={distanceLinked}
            value={distance}
            onValueChange={(next) =>
              updateNodeData(id, { distance: clamp(20, 2000, next) })
            }
          />
        ) : (
          <Input type="number" className="nodrag w-20" disabled value={9999} />
        )}
      </Field>
      {objectVisible && (
        <Slider
          value={[distance]}
          onValueChange={(value) =>
            updateNodeData(id, {
              distance: Array.isArray(value) ? value[0] : value,
            })
          }
          disabled={!objectVisible || distanceLinked}
          min={20}
          max={2000}
          step={10}
          aria-label="Distance slider"
          className="nodrag min-w-24"
        />
      )}
      <Field
        label="Size"
        handle={
          <DataHandle id="size" position={Position.Right} type="target" />
        }
      >
        {objectVisible ? (
          <NodeNumberInput
            className="nodrag w-20"
            max={400}
            min={0}
            step={10}
            disabled={sizeLinked}
            value={size}
            onValueChange={(next) =>
              updateNodeData(id, { size: clamp(0, 400, next) })
            }
          />
        ) : (
          <Input type="number" className="nodrag w-20" disabled value={-1} />
        )}
      </Field>
    </NodeBase>
  )
}
