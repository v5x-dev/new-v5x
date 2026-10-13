import { useId, useRef, type Dispatch } from "react"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Separator } from "#/components/ui/separator"
import { modelPathSet } from "#/lib/parts"
import {
  parseAssembly,
  partsList,
  type AssemblyCommand,
  type AssemblyDocument,
  type AssemblyHistory,
  type Coordinates,
} from "#/lib/assembly"

function download(name: string, contents: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AssemblyPanel({
  history,
  dispatch,
  selectedId,
  onSelect,
  onImport,
  error,
  loaded,
}: {
  history: AssemblyHistory
  dispatch: Dispatch<AssemblyCommand>
  selectedId: string | null
  onSelect: (id: string | null) => void
  onImport: (document: AssemblyDocument) => void
  error: string
  loaded: boolean
}) {
  const formId = useId()
  const input = useRef<HTMLInputElement>(null)
  const message = useRef<HTMLOutputElement>(null)
  const selected = history.present.parts.find((part) => part.id === selectedId)

  return (
    <section
      aria-label="Assembly"
      className="absolute top-4 left-4 z-10 flex max-h-[75%] w-64 flex-col gap-3 overflow-auto rounded-lg border bg-card p-4"
    >
      <label htmlFor={`${formId}-name`} className="flex flex-col gap-1">
        Assembly name
        <Input
          id={`${formId}-name`}
          aria-label="Assembly name"
          value={history.present.name}
          maxLength={120}
          onChange={(event) =>
            dispatch({ type: "rename", name: event.target.value })
          }
        />
      </label>
      <output>
        {error || (loaded ? "Saved locally · Inches" : "Restoring assembly…")}
      </output>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!history.past.length}
          onClick={() => dispatch({ type: "undo" })}
        >
          Undo
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!history.future.length}
          onClick={() => dispatch({ type: "redo" })}
        >
          Redo
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            download(
              "assembly.v5x.json",
              JSON.stringify(history.present, null, 2),
            )
          }
        >
          Export assembly
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => input.current?.click()}
        >
          Import assembly
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const rows = partsList(history.present)
            download(
              "parts.csv",
              "Part,Quantity\n" +
                rows
                  .map(
                    (row) =>
                      `"${row.path.replaceAll('"', '""')}",${row.quantity}`,
                  )
                  .join("\n"),
              "text/csv",
            )
          }}
        >
          Export parts list
        </Button>
      </div>
      <input
        hidden
        ref={input}
        type="file"
        accept=".json"
        aria-label="Import assembly file"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (!file) return
          try {
            if (file.size > 8 * 1024 * 1024)
              throw new Error("Assembly exceeds 8 MiB")
            onImport(parseAssembly(await file.text(), modelPathSet))
            onSelect(null)
            if (message.current)
              message.current.textContent = "Assembly imported"
          } catch (reason) {
            if (message.current) message.current.textContent = String(reason)
          }
        }}
      />
      <output ref={message} />
      <Separator />
      <span>{history.present.parts.length} parts</span>
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
                {index + 1}. {part.path.split("/").at(-1)?.replace(".glb", "")}
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
