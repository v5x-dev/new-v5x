import { createFileRoute } from "@tanstack/react-router"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Grid, Line, OrbitControls, PerspectiveCamera } from "@react-three/drei"
import { useRef } from "react"
import { DoubleSide, MOUSE, type DirectionalLight } from "three"

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

function RouteComponent() {
  return (
    <Canvas>
      <Grid
        args={[18, 18]}
        cellColor="#262626"
        sectionColor="#404040"
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

      <PerspectiveCamera makeDefault position={[6, 4, 6]} />

      <OrbitControls
        mouseButtons={{
          RIGHT: MOUSE.ROTATE,
          MIDDLE: MOUSE.PAN,
          LEFT: undefined,
        }}
      />
    </Canvas>
  )
}
