import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react"

function bezierPath({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  return path
}

export function AdiEdge(props: EdgeProps) {
  return (
    <BaseEdge
      path={bezierPath(props)}
      markerEnd={props.markerEnd}
      style={props.style}
      className={props.selected ? "adi-edge-selected" : "adi-edge"}
    />
  )
}

export function DataEdge(props: EdgeProps) {
  return (
    <BaseEdge
      path={bezierPath(props)}
      markerEnd={props.markerEnd}
      style={props.style}
      className="data-edge"
    />
  )
}
