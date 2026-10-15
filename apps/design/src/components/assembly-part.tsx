import { useFrame, useThree } from "@react-three/fiber"
import { Clone, TransformControls, useGLTF, useHelper } from "@react-three/drei"
import { useRef, type RefObject } from "react"
import {
  BoxHelper,
  DoubleSide,
  Quaternion,
  Vector3,
  type DirectionalLight,
  type Group,
} from "three"
import type { AssemblyPart, Coordinates } from "#/lib/assembly"
import { HOLES, MODEL_SCALE } from "#/lib/holes"
import type { TransformMode } from "#/hooks/use-assembly-document"

export function CameraLight() {
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

export function Part({
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
