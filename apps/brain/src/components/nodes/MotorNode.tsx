import { Position, type Node, type NodeProps } from "@xyflow/react"
import { SmartPortHandle } from "~/components/handles"
import { useHandleConnections } from "~/lib/flow-hooks"
import { cx } from "~/lib/utils"

export function MotorNode({ id }: NodeProps<Node>) {
  const connections = useHandleConnections({
    nodeId: id,
    type: "source",
    id: "smart_port_connector",
  })

  return (
    <div className="motor" aria-label="V5 Smart Motor">
      <div className="port">
        <span className={cx("dot", connections.length > 0 && "on")}></span>
        <SmartPortHandle
          id="connector"
          type="source"
          position={Position.Right}
        />
      </div>

      <div className="housing">
        <div className="fins" aria-hidden="true">
          {Array.from({ length: 11 }, (_, index) => (
            <span key={index}></span>
          ))}
        </div>
      </div>
      <div className="posts" aria-hidden="true">
        <span></span>
        <span></span>
      </div>
    </div>
  )
}
