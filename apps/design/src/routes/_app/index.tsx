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
import {
  Suspense,
  useEffect,
  useReducer,
  useRef,
  useState,
  type RefObject,
} from "react"
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
// GLB models use meters; one scene unit is one inch.
import {
  assemblyHistory,
  editAssembly,
  parseAssembly,
  type AssemblyPart,
  type Coordinates,
} from "#/lib/assembly"
import { HOLES, MODEL_SCALE } from "#/lib/holes"
import { AssemblyPanel } from "#/components/assembly-panel"

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
  onHole,
}: {
  part: AssemblyPart
  selected: boolean
  mode: TransformMode
  dragging: RefObject<boolean>
  onSelect: () => void
  onDraggingChange: (dragging: boolean) => void
  onTransform: (position: Coordinates, rotation: Coordinates) => void
  renderHoles?: boolean
  onHole: (index: number) => void
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
                onClick={(event) => {
                  event.stopPropagation()
                  onHole(index)
                }}
              >
                <planeGeometry args={[0.182, 0.182]} />
                <meshBasicMaterial
                  color="#38bdf8"
                  side={DoubleSide}
                  transparent
                  opacity={0.5}
                  polygonOffset
                  polygonOffsetFactor={-1}
                  polygonOffsetUnits={-1}
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
  const [history, dispatch] = useReducer(editAssembly, undefined, () =>
    assemblyHistory(),
  )
  const parts = history.present.parts
  const [loaded, setLoaded] = useState(false)
  const [saveError, setSaveError] = useState("")
  const restoreFailed = useRef(false)
  const [anchor, setAnchor] = useState<{ id: string; hole: number } | null>(
    null,
  )

  useEffect(() => {
    try {
      const stored = localStorage.getItem("v5x-design-assembly")
      if (stored)
        dispatch({
          type: "replace",
          document: parseAssembly(stored, modelPathSet),
        })
    } catch (error) {
      restoreFailed.current = true
      // Browser storage is restored after SSR hydration.
      // oxlint-disable-next-line react/set-state-in-effect
      setSaveError(`Unable to restore assembly: ${String(error)}`)
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded || restoreFailed.current) return
    try {
      localStorage.setItem(
        "v5x-design-assembly",
        JSON.stringify(history.present),
      )
      // Browser storage status reflects the completed external write.
      // oxlint-disable-next-line react/set-state-in-effect
      setSaveError("")
    } catch (error) {
      setSaveError(
        `Assembly not saved: ${String(error)}. Export a recovery copy.`,
      )
    }
  }, [history.present, loaded])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<TransformMode>("translate")
  const [renderHoles, setRenderHoles] = useState(false)
  const dragging = useRef(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        dragging.current ||
        event.altKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest("input, textarea, select")))
      )
        return

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        dispatch({ type: event.shiftKey ? "redo" : "undo" })
        event.preventDefault()
        return
      }
      if (event.ctrlKey || event.metaKey) return
      switch (event.key.toLowerCase()) {
        case "delete":
        case "backspace":
          if (selectedId) dispatch({ type: "remove", id: selectedId })
          break
        case "escape":
          setSelectedId(null)
          setAnchor(null)
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
  }, [selectedId])

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
        dispatch({
          type: "add",
          part: {
            id,
            path,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
          },
        })
        setSelectedId(id)
      }}
    >
      <AssemblyPanel
        history={history}
        dispatch={dispatch}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onImport={(document) => {
          restoreFailed.current = false
          setSaveError("")
          dispatch({ type: "replace", document })
          setSelectedId(null)
        }}
        error={saveError}
        loaded={loaded}
      />
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
        {anchor
          ? "Click a hole on another part to attach it · Esc to cancel"
          : renderHoles
            ? "Click two holes to attach parts. Angles and C-channels have model-derived holes."
            : selectedId
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
                dispatch({ type: "transform", id: part.id, position, rotation })
              }}
              onHole={(hole) => {
                if (!anchor || anchor.id === part.id) {
                  setAnchor({ id: part.id, hole })
                  return
                }
                const fixed = parts.find((item) => item.id === anchor.id)
                const fixedHole = fixed && HOLES[fixed.path]?.[anchor.hole]
                const movingHole = HOLES[part.path]?.[hole]
                if (fixed && fixedHole && movingHole) {
                  try {
                    const command = {
                      type: "mate" as const,
                      mate: {
                        movingId: part.id,
                        movingHole: hole,
                        fixedId: fixed.id,
                        fixedHole: anchor.hole,
                      },
                    }
                    editAssembly(history, command)
                    dispatch(command)
                  } catch (reason) {
                    setSaveError(String(reason))
                  }
                  setSelectedId(part.id)
                }
                setAnchor(null)
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

        {import.meta.env.DEV && <Perf position="top-left" overClock />}
      </Canvas>
    </div>
  )
}
