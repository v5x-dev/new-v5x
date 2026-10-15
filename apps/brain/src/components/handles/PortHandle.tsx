import {
  Handle,
  useNodeId,
  type Connection,
  type HandleProps,
} from "@xyflow/react"
import type { CSSProperties } from "react"
import { useHandleConnections } from "~/lib/flow-hooks"

interface PortHandleProps {
  id: string
  type: HandleProps["type"]
  position: HandleProps["position"]
  style?: CSSProperties
}

function createPortHandle({
  prefix,
  className,
  connectable,
}: {
  prefix: string
  className: string
  connectable: (type: HandleProps["type"], connections: number) => boolean
}) {
  return function PortHandle({ id, type, position, style }: PortHandleProps) {
    const nodeId = useNodeId()
    const handleId = `${prefix}_${id}`
    const connections = useHandleConnections({
      nodeId: nodeId ?? "",
      id: handleId,
      type,
    })

    if (!nodeId) return null

    return (
      <Handle
        id={handleId}
        className={className}
        isConnectable={connectable(type, connections.length)}
        isValidConnection={(connection) =>
          (connection as Connection).sourceHandle?.startsWith(prefix) ===
            true &&
          (connection as Connection).targetHandle?.startsWith(prefix) === true
        }
        style={style}
        position={position}
        type={type}
      />
    )
  }
}

export const SmartPortHandle = createPortHandle({
  prefix: "smart_port",
  className: "smart-port-handle",
  connectable: (_type, connections) => connections === 0,
})

export const AdiPortHandle = createPortHandle({
  prefix: "adi_port",
  className: "adi-port-handle",
  connectable: (_type, connections) => connections === 0,
})

export const DataHandle = createPortHandle({
  prefix: "data",
  className: "data-handle",
  connectable: (type, connections) => type === "source" || connections === 0,
})

/** A fixed connector that the user cannot drag new wires from. */
export function ConnectorHandle({
  id,
  type,
  position,
  className,
}: PortHandleProps & { className?: string }) {
  const nodeId = useNodeId()
  if (!nodeId) return null

  return (
    <Handle
      id={id}
      className={className}
      type={type}
      isConnectable={false}
      position={position}
    />
  )
}
