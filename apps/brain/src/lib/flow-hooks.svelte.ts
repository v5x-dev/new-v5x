// Keep legacy node bindings on the same stores bound to Svelte Flow 1.x.
import { useSvelteFlow } from "@xyflow/svelte"
import { derived, toStore } from "svelte/store"
import { nodes, edges } from "./stores"
export function useHandleConnections({
  nodeId,
  id,
  type,
}: {
  nodeId: string
  id: string
  type: "source" | "target"
}) {
  return derived(edges, (values) =>
    values
      .filter((edge) =>
        type === "source"
          ? edge.source === nodeId && edge.sourceHandle === id
          : edge.target === nodeId && edge.targetHandle === id,
      )
      .map((edge) => ({ ...edge, edgeId: edge.id })),
  )
}
export function useNodesData(id: string | undefined) {
  return derived(
    nodes,
    (values) => values.find((node) => node.id === id) ?? null,
  )
}
export function useEdges() {
  return edges
}
export function useViewport() {
  const flow = useSvelteFlow()
  return toStore(() => flow.getViewport())
}
