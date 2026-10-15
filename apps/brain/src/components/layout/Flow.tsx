import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  type Connection,
  type EdgeChange,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react"
import { useCallback } from "react"
import { setEdges, setNodes, useApp } from "~/lib/stores"
import { FlowControls } from "./FlowControls"

function connectionEdgeType(connection: Connection) {
  const handle = connection.sourceHandle ?? ""
  if (handle.startsWith("adi_port")) return "adi"
  if (handle.startsWith("data")) return "data"
  return undefined
}

export function Flow({
  nodeTypes,
  edgeTypes,
  showMinimap = true,
}: {
  nodeTypes: NodeTypes
  edgeTypes: EdgeTypes
  showMinimap?: boolean
}) {
  const nodes = useApp((state) => state.nodes)
  const edges = useApp((state) => state.edges)

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    [],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setEdges((current) => applyEdgeChanges(changes, current)),
    [],
  )
  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => [
      ...current,
      {
        ...connection,
        id: `xy-edge__${connection.source}${connection.sourceHandle ?? ""}-${connection.target}${connection.targetHandle ?? ""}`,
        type: connectionEdgeType(connection),
      },
    ])
  }, [])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      attributionPosition="top-right"
      fitView
      fitViewOptions={{ maxZoom: 1.0 }}
    >
      <Background variant={BackgroundVariant.Lines} />
      <FlowControls />
      {showMinimap && <MiniMap />}
    </ReactFlow>
  )
}
