import { Canvas } from "@react-three/fiber"
import { Grid, Line, OrbitControls, PerspectiveCamera } from "@react-three/drei"
import { Suspense, type RefObject } from "react"
import { DoubleSide, MOUSE } from "three"
import { PART_DRAG_TYPE } from "#/lib/parts"
import type { AssemblyHistory, AssemblyPart } from "#/lib/assembly"
import type { AssemblyCommand } from "#/lib/assembly"
import { AssemblyPanel } from "#/components/assembly-panel"
import type { TransformMode } from "#/hooks/use-assembly-document"
import { Toggle } from "@v5x/ui/design/toggle"
import { Move, Rotate3D, ScanLine } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@v5x/ui/design/toggle-group"
import { CameraLight, Part } from "#/components/assembly-part"

export function AssemblyScene({
  parts,
  selectedId,
  mode,
  dragging,
  renderHoles,
  onMode,
  onRenderHoles,
  onSelect,
  onClearSelection,
  onDraggingChange,
  onTransform,
  onHole,
  onDropPart,
  history,
  dispatch,
}: {
  parts: AssemblyPart[]
  selectedId: string | null
  mode: TransformMode
  dragging: RefObject<boolean>
  renderHoles: boolean
  onMode: (mode: TransformMode) => void
  onRenderHoles: (shown: boolean) => void
  onSelect: (id: string | null) => void
  onClearSelection: () => void
  onDraggingChange: (dragging: boolean) => void
  onTransform: (
    part: AssemblyPart,
    position: AssemblyPart["position"],
    rotation: AssemblyPart["rotation"],
  ) => void
  onHole: (part: AssemblyPart, hole: number) => void
  onDropPart: (path: string) => boolean
  history: AssemblyHistory
  dispatch: (command: AssemblyCommand) => void
}) {
  return (
    <div
      className="relative min-h-0 w-full flex-1"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(PART_DRAG_TYPE)) return

        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
      }}
      onDrop={(event) => {
        const path = event.dataTransfer.getData(PART_DRAG_TYPE)
        if (!onDropPart(path)) return
        event.preventDefault()
      }}
    >
      <AssemblyPanel
        history={history}
        dispatch={dispatch}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      <div className="absolute bottom-4 left-4 z-10 flex items-center gap-1 rounded-lg border bg-card p-1">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value === "translate" || value === "rotate") onMode(value)
          }}
          size="icon"
          spacing={1}
          aria-label="Transform tool"
        >
          <ToggleGroupItem value="translate" aria-label="Move" title="Move (W)">
            <Move />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="rotate"
            aria-label="Rotate"
            title="Rotate (E)"
          >
            <Rotate3D />
          </ToggleGroupItem>
        </ToggleGroup>
        <Toggle
          variant="default"
          pressed={renderHoles}
          onPressedChange={onRenderHoles}
          size="icon"
          aria-label="Show holes"
          title="Show holes"
        >
          <ScanLine />
        </Toggle>
      </div>
      <Canvas
        onPointerMissed={(event) => {
          if (event.button === 0 && !dragging.current) onClearSelection()
        }}
      >
        {parts.map((part) => (
          <Suspense key={part.id} fallback={null}>
            <Part
              part={part}
              selected={selectedId === part.id}
              mode={mode}
              dragging={dragging}
              onSelect={() => onSelect(part.id)}
              onDraggingChange={onDraggingChange}
              onTransform={(position, rotation) =>
                onTransform(part, position, rotation)
              }
              onHole={(hole) => onHole(part, hole)}
              renderHoles={renderHoles}
            />
          </Suspense>
        ))}

        <Grid
          args={[18, 18]}
          cellColor="#404040"
          sectionColor="#525252"
          sectionSize={3}
          cellSize={0.5}
          side={DoubleSide}
        />

        <Line
          lineWidth={2}
          color="#dc2626"
          points={[
            [-9, 0, 0],
            [9, 0, 0],
          ]}
        />

        <Line
          lineWidth={2}
          color="#65a30d"
          points={[
            [0, 0, -9],
            [0, 0, 9],
          ]}
        />

        <Line
          lineWidth={2}
          color="#0284c7"
          points={[
            [0, 0, 0],
            [0, 1, 0],
          ]}
        />

        <CameraLight />
        <ambientLight intensity={0.25} />

        <PerspectiveCamera makeDefault position={[6, 4, 6]} />

        <OrbitControls
          makeDefault
          mouseButtons={{
            RIGHT: MOUSE.ROTATE,
            MIDDLE: MOUSE.PAN,
            LEFT: undefined,
          }}
        />
      </Canvas>
    </div>
  )
}
