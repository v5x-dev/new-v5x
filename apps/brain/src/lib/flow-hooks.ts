import { useShallow } from "zustand/react/shallow"
import { useApp } from "./stores"

export function useHandleConnections({
  nodeId,
  id,
  type,
}: {
  nodeId: string
  id: string
  type: "source" | "target"
}) {
  return useApp(
    useShallow((state) =>
      state.edges.filter((edge) =>
        type === "source"
          ? edge.source === nodeId && edge.sourceHandle === id
          : edge.target === nodeId && edge.targetHandle === id,
      ),
    ),
  )
}

export function useNodesData(id: string | undefined) {
  return useApp((state) =>
    id ? (state.nodes.find((node) => node.id === id) ?? null) : null,
  )
}
