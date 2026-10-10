import { createFileRoute } from "@tanstack/react-router"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import {
  Clone,
  Grid,
  Line,
  OrbitControls,
  PerspectiveCamera,
  TransformControls,
  useGLTF,
  useHelper,
} from "@react-three/drei"
import { Suspense, useEffect, useRef, useState, type RefObject } from "react"
import { modelPathSet, PART_DRAG_TYPE } from "#/lib/parts"
import {
  BoxHelper,
  DoubleSide,
  MOUSE,
  Quaternion,
  Vector3,
  type DirectionalLight,
  type Group,
} from "three"
import { Perf } from "r3f-perf"
import { Toggle } from "#/components/ui/toggle"
import { Move, Rotate3D, ScanLine } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group"

type TransformMode = "translate" | "rotate"
type Coordinates = [number, number, number]

interface AssemblyPart {
  id: string
  path: string
  position: Coordinates
  rotation: Coordinates
}

interface Hole {
  center: number[]
  axis: number[]
  type: string
}

const HOLES: Record<string, Hole[]> = {
  "/models/vex-v5rc-parts/angles/aluminum/1x1x35-aluminum-angle.glb": [
    ...Array.from({ length: 35 }, (_, i) => ({
      center: [i / 2 - 8.5, 0.045, -0.218],
      axis: [0, 0, 0],
      type: "square",
    })),
    ...Array.from({ length: 35 }, (_, i) => ({
      center: [i / 2 - 8.5, -0.218, 0.045],
      axis: [0, 1, 0],
      type: "square",
    })),
  ],
} as const

// GLB models use meters; one scene unit represents 0.5 inches.
const MODEL_SCALE = 1 / 0.0254

export const Route = createFileRoute("/_app/")({
  component: RouteComponent,
})

function CameraLight() {
  const light = useRef<DirectionalLight>(null)
  const { camera } = useThree()

  useFrame(() => {
    if (!light.current) return

    light.current.position.copy(camera.position)
    light.current.target.position
      .copy(camera.position)
      .add(camera.getWorldDirection(light.current.target.position))

    light.current.target.updateMatrixWorld()
  })

  return <directionalLight ref={light} intensity={1} />
}

function Part({
  part,
  selected,
  mode,
  dragging,
  onSelect,
  onDraggingChange,
  onTransform,
  renderHoles = false,
}: {
  part: AssemblyPart
  selected: boolean
  mode: TransformMode
  dragging: RefObject<boolean>
  onSelect: () => void
  onDraggingChange: (dragging: boolean) => void
  onTransform: (position: Coordinates, rotation: Coordinates) => void
  renderHoles?: boolean
}) {
  const { path } = part
  const { scene } = useGLTF(path)
  const group = useRef<Group>(null!)

  useHelper(selected && group, BoxHelper, "#38bdf8")

  return (
    <>
      <group
        ref={group}
        position={part.position}
        rotation={part.rotation}
        onClick={(event) => {
          event.stopPropagation()
          if (event.button === 0 && event.delta <= 2 && !dragging.current)
            onSelect()
        }}
      >
        <Clone object={scene} scale={MODEL_SCALE} position={[0, 0, 0]} />

        {renderHoles &&
          HOLES[path]?.map((hole, index) => {
            if (hole.type !== "square") return null

            const orientation = new Quaternion().setFromUnitVectors(
              new Vector3(0, 0, 1),
              new Vector3(...hole.axis).normalize(),
            )

            return (
              <mesh
                key={index}
                position={hole.center as [number, number, number]}
                quaternion={orientation}
              >
                <planeGeometry args={[0.182, 0.182]} />
                <meshBasicMaterial
                  color="#38bdf8"
                  side={DoubleSide}
                  transparent
                  opacity={0.5}
                />
              </mesh>
            )
          })}
      </group>
      {selected && (
        <TransformControls
          object={group}
          mode={mode}
          space="world"
          onMouseDown={() => {
            onDraggingChange(true)
          }}
          onMouseUp={() => {
            onDraggingChange(false)
            if (!group.current) return
            onTransform(group.current.position.toArray(), [
              group.current.rotation.x,
              group.current.rotation.y,
              group.current.rotation.z,
            ])
          }}
        />
      )}
    </>
  )
}

function RouteComponent() {
  const [parts, setParts] = useState<AssemblyPart[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<TransformMode>("translate")
  const [renderHoles, setRenderHoles] = useState(false)
  const dragging = useRef(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        dragging.current ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest("input, textarea, select")))
      )
        return

      switch (event.key.toLowerCase()) {
        case "escape":
          setSelectedId(null)
          break
        case "w":
          setMode("translate")
          break
        case "e":
          setMode("rotate")
          break
        default:
          return
      }
      event.preventDefault()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <div
      className="relative h-full w-full"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(PART_DRAG_TYPE)) return

        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
      }}
      onDrop={(event) => {
        const path = event.dataTransfer.getData(PART_DRAG_TYPE)
        if (!modelPathSet.has(path)) return

        event.preventDefault()
        const id = crypto.randomUUID()
        setParts((current) => [
          ...current,
          {
            id,
            path,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
          },
        ])
        setSelectedId(id)
      }}
    >
      <div className="absolute bottom-4 left-4 z-10 flex items-center gap-1 rounded-lg border bg-card p-1">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value === "translate" || value === "rotate") setMode(value)
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
          onPressedChange={setRenderHoles}
          size="icon"
          aria-label="Show holes"
          title="Show holes"
        >
          <ScanLine />
        </Toggle>
      </div>
      <div
        className="pointer-events-none absolute top-4 right-4 z-10 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground"
        aria-live="polite"
      >
        {selectedId
          ? "Drag an axis to transform · Esc to deselect"
          : "Click a part to select"}
      </div>
      <Canvas
        onPointerMissed={(event) => {
          if (event.button === 0 && !dragging.current) setSelectedId(null)
        }}
      >
        {parts.map((part) => (
          <Suspense key={part.id} fallback={null}>
            <Part
              part={part}
              selected={selectedId === part.id}
              mode={mode}
              dragging={dragging}
              onSelect={() => setSelectedId(part.id)}
              onDraggingChange={(value) => {
                dragging.current = value
              }}
              onTransform={(position, rotation) => {
                setParts((current) =>
                  current.map((item) =>
                    item.id === part.id
                      ? { ...item, position, rotation }
                      : item,
                  ),
                )
              }}
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

        <Perf position="top-left" overClock />
      </Canvas>
    </div>
  )
}
