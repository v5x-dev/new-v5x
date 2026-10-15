import {
  useReactFlow,
  useViewport,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react"
import {
  useEffect,
  useRef,
  type ComponentType,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react"
import type { DragData } from "~/components/layout/Sidebar"
import { setNodes, useApp } from "~/lib/stores"

function overGrid(x: number, y: number) {
  return document.elementsFromPoint(x, y).some((element) => {
    return (
      element instanceof Element &&
      element.closest(".display-view") != null &&
      element.closest(".drag-overlay") == null
    )
  })
}

function randomId() {
  return (
    crypto.randomUUID?.() ??
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
  )
}

export function DragNDropOverlay({
  dragNode,
  setDragNode,
  nodeTypes,
}: {
  dragNode: DragData | null
  setDragNode: Dispatch<SetStateAction<DragData | null>>
  nodeTypes: NodeTypes
}) {
  const { screenToFlowPosition } = useReactFlow()
  const { zoom } = useViewport()
  const dragging = dragNode !== null
  const latest = useRef(dragNode)
  latest.current = dragNode

  useEffect(() => {
    if (!dragging) return

    const handleMove = (event: MouseEvent) => {
      setDragNode(
        (current) =>
          current && {
            ...current,
            x: event.clientX,
            y: event.clientY,
            valid: overGrid(event.clientX, event.clientY),
          },
      )
    }

    const handleNodeDrop = (event: MouseEvent) => {
      const drag = latest.current
      if (!drag) return

      if (overGrid(event.clientX, event.clientY)) {
        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        })

        const headerOffset = -18
        position.y += headerOffset

        const controllerIds = new Set(
          useApp
            .getState()
            .nodes.filter((node) => node.type === "controller")
            .map((node) => node.data.controllerId),
        )
        const controllerId = [0, 1].find((id) => !controllerIds.has(id))

        if (drag.nodeType === "controller" && controllerId === undefined) {
          setDragNode(null)
          return
        }

        const newNode = {
          id: randomId(),
          type: drag.nodeType,
          position,
          data:
            drag.nodeType === "controller"
              ? {
                  controllerId,
                  axis1: 0,
                  axis2: 0,
                  axis3: 0,
                  axis4: 0,
                  buttons: 0,
                  capacity: 100,
                  connected: false,
                }
              : { label: `${drag.nodeType} node` },
          origin: [0.5, 0.0],
        } satisfies Node

        setNodes((current) => [...current, newNode])
      }

      setDragNode(null)
    }

    window.addEventListener("mousemove", handleMove)
    window.addEventListener("mouseup", handleNodeDrop)
    return () => {
      window.removeEventListener("mousemove", handleMove)
      window.removeEventListener("mouseup", handleNodeDrop)
    }
  }, [dragging, screenToFlowPosition, setDragNode])

  const Preview = (dragNode ? nodeTypes[dragNode.nodeType] : undefined) as
    | ComponentType<NodeProps>
    | undefined

  return (
    <div className="drag-overlay pointer-events-none absolute inset-0 z-1000 overflow-hidden">
      {dragNode && Preview && (
        <div
          className={`drag-item react-flow__node pointer-events-none absolute z-1000 transform-[scale(var(--flow-zoom,1))_translate(-50%,calc(-36px/2))] [box-shadow:0_4px_8px_rgba(0,0,0,0.35)] [&.drag-item[data-valid='false']]:opacity-90! [&.drag-item[data-valid='false']]:grayscale-75! react-flow__node-${dragNode.nodeType}`}
          data-valid={dragNode.valid}
          style={
            {
              top: dragNode.y,
              left: dragNode.x,
              "--flow-zoom": zoom,
            } as CSSProperties
          }
        >
          <Preview
            id="drag-preview"
            type={dragNode.nodeType}
            selected={false}
            dragging={true}
            draggable={false}
            selectable={false}
            deletable={false}
            isConnectable={false}
            positionAbsoluteX={dragNode.x}
            positionAbsoluteY={dragNode.y}
            zIndex={1000}
            data={{}}
          />
        </div>
      )}
    </div>
  )
}
