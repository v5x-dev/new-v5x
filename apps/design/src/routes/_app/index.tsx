import { createFileRoute } from "@tanstack/react-router"
import { AssemblyScene } from "#/components/assembly-scene"
import { AssemblyToolbar } from "#/components/assembly-toolbar"
import { useAssemblyDocument } from "#/hooks/use-assembly-document"

export const Route = createFileRoute("/_app/")({
  component: RouteComponent,
})

function RouteComponent() {
  const assembly = useAssemblyDocument()

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <AssemblyToolbar
        history={assembly.history}
        dispatch={assembly.dispatch}
        onSelect={assembly.setSelectedId}
        onImport={assembly.importDocument}
        error={assembly.saveError}
      />
      <AssemblyScene
        parts={assembly.parts}
        selectedId={assembly.selectedId}
        mode={assembly.mode}
        dragging={assembly.dragging}
        renderHoles={assembly.renderHoles}
        onMode={assembly.setMode}
        onRenderHoles={assembly.setRenderHoles}
        onSelect={assembly.setSelectedId}
        onClearSelection={() => assembly.setSelectedId(null)}
        onDraggingChange={assembly.setDragging}
        onTransform={(part, position, rotation) => {
          assembly.dispatch({
            type: "transform",
            id: part.id,
            position,
            rotation,
          })
        }}
        onHole={assembly.mateHole}
        onDropPart={assembly.addPart}
        history={assembly.history}
        dispatch={assembly.dispatch}
      />
    </div>
  )
}
