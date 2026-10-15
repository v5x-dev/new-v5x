import {
  Position,
  useReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import { useRef, useState } from "react"
import { SmartPortHandle } from "~/components/handles"
import { GPSSensor } from "~/components/icons"
import { NodeBase } from "~/components/NodeBase"
import { useDrag } from "~/hooks/use-drag"

export function GpsNode({ id: _id }: NodeProps<Node>) {
  const { screenToFlowPosition } = useReactFlow()
  const [position, setPosition] = useState({
    x: 150 / 2 - 11,
    y: 150 / 2 - 11,
  })
  const draggableContainer = useRef<HTMLDivElement>(null)

  const dragRef = useDrag<HTMLDivElement>((event) => {
    const container = draggableContainer.current
    if (!container) return
    const flowCoords = screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    })
    const boundingRect = container.getBoundingClientRect()
    const boundingCoords = screenToFlowPosition({
      x: boundingRect.left,
      y: boundingRect.top,
    })
    const relativeX = flowCoords.x - boundingCoords.x - 14
    const relativeY = flowCoords.y - boundingCoords.y - 14
    setPosition({
      x: Math.max(0, Math.min(150 - 28, relativeX)),
      y: Math.max(0, Math.min(150 - 28, relativeY)),
    })
  })

  return (
    <NodeBase
      title="GPS Sensor"
      handle={
        <SmartPortHandle
          id="connector"
          type="source"
          position={Position.Left}
        />
      }
      icon={<GPSSensor size="16" />}
    >
      <div className="coordinates flex w-full gap-2.5">
        <span>x: {Math.round(position.x * 10) / 10}</span>
        <span>x: {Math.round(position.y * 10) / 10}</span>
      </div>
      <div
        ref={draggableContainer}
        className="position nodrag h-37.5 w-37.5 cursor-default rounded-2xl border-2 border-primary bg-card"
      >
        <div
          ref={dragRef}
          className="draggable relative cursor-grab [&.draggable:active]:cursor-grabbing! [&.draggable:hover]:text-foreground!"
          style={{ top: position.y, left: position.x }}
        >
          <svg width="24px" height="24">
            <circle
              cx="12"
              cy="12"
              r="11"
              stroke="currentColor"
              fill="none"
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>
    </NodeBase>
  )
}
