import { useId, useState, type Dispatch } from "react"
import { Button } from "@v5x/ui/design/button"
import { Input } from "@v5x/ui/design/input"
import { Separator } from "@v5x/ui/design/separator"
import { partName } from "#/lib/parts"
import { HOLES } from "#/lib/holes"
import { editAssembly } from "#/lib/assembly"
import {
  type AssemblyCommand,
  type AssemblyHistory,
  type Coordinates,
} from "#/lib/assembly"

export function AssemblyPanel({
  history,
  dispatch,
  selectedId,
  onSelect,
}: {
  history: AssemblyHistory
  dispatch: Dispatch<AssemblyCommand>
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const [fixedId, setFixedId] = useState("")
  const [movingHole, setMovingHole] = useState(1)
  const [fixedHole, setFixedHole] = useState(1)
  const [mateError, setMateError] = useState("")
  const formId = useId()
  const selected = history.present.parts.find((part) => part.id === selectedId)

  if (!history.present.parts.length) return null

  return (
    <section
      aria-label="Assembly parts"
      className="absolute top-4 left-4 z-10 flex max-h-[75%] w-64 flex-col gap-3 overflow-auto rounded-lg border bg-card p-4"
    >
      <ul className="flex flex-col gap-1">
        {history.present.parts.map((part, index) => (
          <li key={part.id}>
            <Button
              variant={part.id === selectedId ? "secondary" : "ghost"}
              size="sm"
              className="w-full justify-start"
              aria-pressed={part.id === selectedId}
              onClick={() => onSelect(part.id)}
            >
              <span className="truncate">
                {index + 1}. {partName(part.path)}
              </span>
            </Button>
          </li>
        ))}
      </ul>
      {selected && (
        <>
          <Separator />
          <fieldset className="flex flex-col gap-2">
            <legend>Position in inches</legend>
            {(["X", "Y", "Z"] as const).map((axis, index) => (
              <label key={axis} className="flex items-center gap-2">
                {axis}
                <Input
                  type="number"
                  step="0.5"
                  aria-label={`Position ${axis}`}
                  value={selected.position[index]}
                  onChange={(event) => {
                    if (event.target.value === "") return
                    const value = Number(event.target.value)
                    if (!Number.isFinite(value) || Math.abs(value) > 100_000)
                      return
                    const position: Coordinates = [...selected.position]
                    position[index] = value
                    dispatch({
                      type: "transform",
                      id: selected.id,
                      position,
                      rotation: selected.rotation,
                    })
                  }}
                />
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend>Rotation in degrees</legend>
            {(["X", "Y", "Z"] as const).map((axis, index) => (
              <label key={axis} className="flex items-center gap-2">
                {axis}
                <Input
                  type="number"
                  step="15"
                  aria-label={`Rotation ${axis}`}
                  value={Number(
                    ((selected.rotation[index] * 180) / Math.PI).toFixed(3),
                  )}
                  onChange={(event) => {
                    if (event.target.value === "") return
                    const value = Number(event.target.value)
                    if (!Number.isFinite(value) || Math.abs(value) > 36000)
                      return
                    const rotation: Coordinates = [...selected.rotation]
                    rotation[index] = (value * Math.PI) / 180
                    dispatch({
                      type: "transform",
                      id: selected.id,
                      position: selected.position,
                      rotation,
                    })
                  }}
                />
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend>Hole attachments</legend>
            <p className="text-xs text-muted-foreground">
              Attached parts move as a rigid group. Detach to move them
              independently. Hole positions come from model geometry.
            </p>
            {(history.present.mates ?? [])
              .filter(
                (mate) =>
                  mate.movingId === selected.id || mate.fixedId === selected.id,
              )
              .map((mate) => (
                <Button
                  key={`${mate.movingId}-${mate.fixedId}`}
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    dispatch({
                      type: "detach",
                      movingId: mate.movingId,
                      fixedId: mate.fixedId,
                    })
                  }
                >
                  Detach{" "}
                  {history.present.parts
                    .find(
                      (part) =>
                        part.id ===
                        (mate.movingId === selected.id
                          ? mate.fixedId
                          : mate.movingId),
                    )
                    ?.path.split("/")
                    .at(-1)
                    ?.replace(".glb", "")}
                </Button>
              ))}
            {HOLES[selected.path] && (
              <>
                <label className="flex flex-col gap-1">
                  Attach to part
                  <select
                    aria-label="Attach to part"
                    className="rounded-md border bg-background p-2"
                    value={fixedId}
                    onChange={(event) => {
                      setFixedId(event.target.value)
                      setFixedHole(1)
                    }}
                  >
                    <option value="">Choose a part</option>
                    {history.present.parts
                      .filter(
                        (part) => part.id !== selected.id && HOLES[part.path],
                      )
                      .map((part, index) => (
                        <option key={part.id} value={part.id}>
                          {index + 1}. {partName(part.path)}
                        </option>
                      ))}
                  </select>
                </label>
                <label
                  htmlFor={`${formId}-moving-hole`}
                  className="flex flex-col gap-1"
                >
                  Selected part hole
                  <Input
                    id={`${formId}-moving-hole`}
                    aria-label="Selected part hole"
                    type="number"
                    min={1}
                    max={HOLES[selected.path].length}
                    value={movingHole}
                    onChange={(event) =>
                      setMovingHole(Number(event.target.value))
                    }
                  />
                </label>
                <label
                  htmlFor={`${formId}-fixed-hole`}
                  className="flex flex-col gap-1"
                >
                  Fixed part hole
                  <Input
                    id={`${formId}-fixed-hole`}
                    aria-label="Fixed part hole"
                    type="number"
                    min={1}
                    value={fixedHole}
                    onChange={(event) =>
                      setFixedHole(Number(event.target.value))
                    }
                  />
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!fixedId}
                  onClick={() => {
                    const command: AssemblyCommand = {
                      type: "mate",
                      mate: {
                        movingId: selected.id,
                        movingHole: movingHole - 1,
                        fixedId,
                        fixedHole: fixedHole - 1,
                      },
                    }
                    try {
                      editAssembly(history, command)
                      dispatch(command)
                      setMateError("")
                    } catch (reason) {
                      setMateError(String(reason))
                    }
                  }}
                >
                  Attach holes
                </Button>
              </>
            )}
            {mateError && <p role="alert">{mateError}</p>}
          </fieldset>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const newId = crypto.randomUUID()
                dispatch({ type: "duplicate", id: selected.id, newId })
                onSelect(newId)
              }}
            >
              Duplicate
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                dispatch({ type: "remove", id: selected.id })
                onSelect(null)
              }}
            >
              Delete
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
