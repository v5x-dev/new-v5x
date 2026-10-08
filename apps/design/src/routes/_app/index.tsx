import { createFileRoute } from "@tanstack/react-router"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import {
  Clone,
  Grid,
  Line,
  OrbitControls,
  PerspectiveCamera,
  useGLTF,
} from "@react-three/drei"
import { Suspense, useRef, useState } from "react"
import { modelPathSet, PART_DRAG_TYPE } from "#/lib/parts"
import {
  DoubleSide,
  MOUSE,
  Quaternion,
  Vector3,
  type DirectionalLight,
} from "three"
import { Perf } from "r3f-perf"
import { Toggle } from "#/components/ui/toggle"
import { ScanLine } from "lucide-react"

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
  path,
  renderHoles = false,
}: {
  path: string
  renderHoles?: boolean
}) {
  const { scene } = useGLTF(path)

  return (
    <group>
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
  )
}

function RouteComponent() {
  const [parts, setParts] = useState<{ id: string; path: string }[]>([])

  const [renderHoles, setRenderHoles] = useState(false)

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
        setParts((current) => [...current, { id: crypto.randomUUID(), path }])
      }}
    >
      <div className="absolute bottom-4 left-4 z-10 flex flex-col rounded-lg border bg-card p-1">
        <Toggle
          variant="default"
          pressed={renderHoles}
          onPressedChange={setRenderHoles}
          size="icon"
        >
          <ScanLine />
        </Toggle>
      </div>
      <Canvas>
        {parts.map((part) => (
          <Suspense key={part.id} fallback={null}>
            <Part path={part.path} renderHoles={renderHoles} />
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
