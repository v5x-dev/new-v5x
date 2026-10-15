import { Panel, useReactFlow, useStore, useStoreApi } from "@xyflow/react"
import { Lock, LockOpen, Maximize, Minus, Plus } from "lucide-react"
import { Button } from "~/components/ui/button"

export function FlowControls() {
  const store = useStoreApi()
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const zoom = useStore((state) => state.transform[2])
  const minZoom = useStore((state) => state.minZoom)
  const maxZoom = useStore((state) => state.maxZoom)
  const interactive = useStore(
    (state) =>
      state.nodesDraggable ||
      state.nodesConnectable ||
      state.elementsSelectable,
  )

  function toggleInteractivity() {
    const enabled = !interactive
    store.setState({
      nodesDraggable: enabled,
      nodesConnectable: enabled,
      elementsSelectable: enabled,
    })
  }

  return (
    <Panel position="bottom-left" aria-label="Canvas controls">
      <div className="flex flex-col gap-1 rounded-lg border bg-background p-1 shadow-sm">
        <Button
          variant="ghost"
          size="icon"
          title="Zoom in"
          aria-label="Zoom in"
          disabled={zoom >= maxZoom}
          onClick={() => void zoomIn()}
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Zoom out"
          aria-label="Zoom out"
          disabled={zoom <= minZoom}
          onClick={() => void zoomOut()}
        >
          <Minus />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Fit view"
          aria-label="Fit view"
          onClick={() => void fitView()}
        >
          <Maximize />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title={interactive ? "Lock canvas" : "Unlock canvas"}
          aria-label={interactive ? "Lock canvas" : "Unlock canvas"}
          aria-pressed={!interactive}
          onClick={toggleInteractivity}
        >
          {interactive ? <LockOpen /> : <Lock />}
        </Button>
      </div>
    </Panel>
  )
}
