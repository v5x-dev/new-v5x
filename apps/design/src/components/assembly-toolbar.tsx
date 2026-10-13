import { useRef, type Dispatch } from "react"
import { FileDown, ListOrdered, Redo2, Undo2, Upload } from "lucide-react"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { modelPathSet } from "#/lib/parts"
import {
  parseAssembly,
  partsList,
  type AssemblyCommand,
  type AssemblyDocument,
  type AssemblyHistory,
} from "#/lib/assembly"

function download(name: string, contents: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AssemblyToolbar({
  history,
  dispatch,
  onSelect,
  onImport,
  error,
}: {
  history: AssemblyHistory
  dispatch: Dispatch<AssemblyCommand>
  onSelect: (id: string | null) => void
  onImport: (document: AssemblyDocument) => void
  error: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const message = useRef<HTMLOutputElement>(null)

  return (
    <header
      aria-label="Assembly"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-card px-4 py-3"
    >
      <Input
        className="w-48"
        aria-label="Assembly name"
        value={history.present.name}
        maxLength={120}
        onChange={(event) =>
          dispatch({ type: "rename", name: event.target.value })
        }
      />
      {error && (
        <output className="text-sm text-muted-foreground">{error}</output>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Undo"
          title="Undo"
          disabled={!history.past.length}
          onClick={() => dispatch({ type: "undo" })}
        >
          <Undo2 />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Redo"
          title="Redo"
          disabled={!history.future.length}
          onClick={() => dispatch({ type: "redo" })}
        >
          <Redo2 />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Export assembly"
          title="Export assembly"
          onClick={() =>
            download(
              "assembly.v5x.json",
              JSON.stringify(history.present, null, 2),
            )
          }
        >
          <FileDown />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Import assembly"
          title="Import assembly"
          onClick={() => input.current?.click()}
        >
          <Upload />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Export parts list"
          title="Export parts list"
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
          <ListOrdered />
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
      <output ref={message} className="text-sm empty:hidden" />
    </header>
  )
}
