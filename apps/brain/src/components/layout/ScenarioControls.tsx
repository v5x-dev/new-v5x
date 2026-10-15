import type { Node } from "@xyflow/react"
import { useEffect, useRef, useState } from "react"
import { Button } from "~/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { listen } from "~/lib/runtime"
import {
  applyScenarioFrame,
  captureFrame,
  emptyScenario,
  parseScenario,
  ScenarioOutput,
  scenarioKey,
  type SavedScenario,
} from "~/lib/saved-scenarios"
import { distanceScenario } from "~/lib/scenarios"
import { setNodes, useApp, useSession } from "~/lib/stores"

export function ScenarioControls() {
  const { running: programRunning } = useSession()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(() =>
    JSON.stringify(emptyScenario(), null, 2),
  )
  const [at, setAt] = useState(0)
  const [message, setMessage] = useState("")
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const unlisten = useRef<(() => void)[]>([])
  const original = useRef<Node[] | undefined>(undefined)
  const fileInput = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const restartPending = useRef(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(scenarioKey)
      if (stored) {
        const restored = parseScenario(stored)
        setDraft(JSON.stringify(restored, null, 2))
      }
    } catch (reason) {
      setMessage(`Unable to restore scenario: ${String(reason)}`)
    }
  }, [])

  function stop(restore = true) {
    generation.current++
    clearTimeout(timer.current)
    unlisten.current.splice(0).forEach((fn) => fn())
    if (restore && original.current) setNodes(original.current)
    original.current = undefined
    setRunning(false)
    if (!restartPending.current) setStarting(false)
  }

  useEffect(() => () => stop(false), [])

  function save(source = draft) {
    const parsed = parseScenario(source)
    localStorage.setItem(scenarioKey, JSON.stringify(parsed))
    setMessage("Scenario saved in this browser")
    return parsed
  }

  function capture() {
    try {
      const { nodes, edges } = useApp.getState()
      const editable = JSON.parse(draft) as SavedScenario
      editable.frames = [
        ...editable.frames.filter((frame) => frame.at !== at),
        captureFrame(nodes, edges, at),
      ].sort((a, b) => a.at - b.at)
      const parsed = parseScenario(JSON.stringify(editable))
      setDraft(JSON.stringify(parsed, null, 2))
      setAt(at + 1000)
      setMessage("Captured current distance and controller settings")
    } catch (reason) {
      setMessage(String(reason))
    }
  }

  function distanceExample() {
    try {
      const { nodes, edges } = useApp.getState()
      const captured = captureFrame(nodes, edges, 0)
      if (!captured.distances.length)
        throw new Error("Connect a distance sensor to a Brain smart port first")
      const example: SavedScenario = {
        version: 1,
        name: "Distance approach",
        frames: distanceScenario.map((frame) => ({
          ...captured,
          at: frame.at,
          distances: captured.distances.map((sensor) => ({
            ...sensor,
            distance: frame.distance,
            visible: frame.visible,
          })),
        })),
        expectations: [],
      }
      setDraft(JSON.stringify(example, null, 2))
      setMessage("Distance example loaded. Add output checks for your program.")
    } catch (reason) {
      setMessage(String(reason))
    }
  }

  async function replay() {
    try {
      const current = save()
      const active = useApp.getState().session
      if (!active?.running) throw new Error("Load a program before replaying")
      // Validate every target before resetting the running program.
      for (const frame of current.frames)
        applyScenarioFrame(
          useApp.getState().nodes,
          useApp.getState().edges,
          frame,
        )
      stop()
      const run = generation.current
      setStarting(true)
      restartPending.current = true
      original.current = useApp.getState().nodes
      if (current.frames[0]!.at === 0)
        setNodes(
          applyScenarioFrame(
            useApp.getState().nodes,
            useApp.getState().edges,
            current.frames[0]!,
          ),
        )
      await active.stop()
      if (run !== generation.current) return
      const output = new ScenarioOutput(current.expectations)
      let started: number | undefined
      const detachOutput = await listen<number[]>(
        "brain_usb_recv",
        ({ payload }) =>
          output.push(
            new Uint8Array(payload),
            started === undefined ? 0 : performance.now() - started,
          ),
      )
      if (run !== generation.current) {
        detachOutput()
        return
      }
      unlisten.current.push(detachOutput)
      await active.start()
      if (run !== generation.current) return
      started = performance.now()
      setStarting(false)
      setRunning(true)
      const duration = Math.max(
        current.frames.at(-1)!.at,
        ...current.expectations.map((item) => item.by),
      )
      let step = 0
      function tick() {
        if (run !== generation.current) return
        const session = useApp.getState().session
        if (!session?.running || session.paused) {
          stop()
          setMessage("Scenario stopped because program stopped or paused")
          return
        }
        const elapsed = performance.now() - started!
        try {
          while (
            step < current.frames.length &&
            current.frames[step]!.at <= elapsed
          ) {
            const frame = current.frames[step]!
            setNodes((nodes) =>
              applyScenarioFrame(nodes, useApp.getState().edges, frame),
            )
            step++
          }
        } catch (reason) {
          stop()
          setMessage(String(reason))
          return
        }
        if (elapsed >= duration) {
          const results = output.results()
          stop()
          setMessage(
            results.length
              ? results
                  .map(
                    (item) =>
                      `${item.passed ? "PASS" : "FAIL"}: "${item.text}" by ${item.by} ms`,
                  )
                  .join("\n")
              : "Replay complete. No output checks configured.",
          )
        } else
          timer.current = setTimeout(tick, Math.min(25, duration - elapsed))
      }
      tick()
    } catch (reason) {
      stop()
      setMessage(String(reason))
    } finally {
      restartPending.current = false
      setStarting(false)
    }
  }

  function exportScenario() {
    try {
      const saved = save()
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(saved, null, 2)], {
          type: "application/json",
        }),
      )
      const link = document.createElement("a")
      link.href = url
      link.download = "scenario.v5x.json"
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (reason) {
      setMessage(String(reason))
    }
  }

  const busy = running || starting

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Scenarios
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Simulation scenarios</DialogTitle>
            <DialogDescription>
              Set device values on the canvas, then capture frames. Replay
              restarts the program and restores your device settings afterward.
              Output checks match text printed by your program before a
              deadline.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1">
            Frame time in milliseconds
            <input
              className="rounded-md border bg-background p-2"
              type="number"
              min="0"
              max="600000"
              step="1000"
              value={at}
              onChange={(event) =>
                setAt(event.currentTarget.valueAsNumber || 0)
              }
              disabled={busy}
            />
          </label>
          <Button variant="outline" onClick={capture} disabled={busy}>
            Capture device settings
          </Button>
          <label className="flex flex-col gap-1">
            Scenario timeline
            <textarea
              className="h-64 rounded-md border bg-background p-2 font-mono"
              aria-label="Scenario timeline"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              disabled={busy}
            ></textarea>
          </label>
          <p>
            To check output, add an expectation such as{" "}
            {JSON.stringify({ by: 5000, text: "READY" })} to the expectations
            list. Frames target distance sensors by smart port and controllers
            by ID.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={distanceExample} disabled={busy}>
              Use distance example
            </Button>
            <Button
              onClick={() => {
                try {
                  save()
                } catch (reason) {
                  setMessage(String(reason))
                }
              }}
              disabled={busy}
            >
              Save scenario
            </Button>
            <Button variant="outline" onClick={exportScenario} disabled={busy}>
              Export scenario
            </Button>
            <Button
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              Import scenario
            </Button>
            <Button
              onClick={() => void replay()}
              disabled={!programRunning || busy}
            >
              Replay from start
            </Button>
            {busy && (
              <Button
                variant="outline"
                onClick={() => {
                  stop()
                  setMessage("Replay cancelled")
                }}
              >
                Stop replay
              </Button>
            )}
          </div>
          <p role="status" className="whitespace-pre-wrap">
            {running
              ? "Replaying scenario…"
              : starting
                ? "Restarting program…"
                : message}
          </p>
          <input
            ref={fileInput}
            className="hidden"
            type="file"
            accept=".json"
            aria-label="Import scenario file"
            onChange={async (event) => {
              const input = event.currentTarget
              const file = input.files?.[0]
              input.value = ""
              if (!file) return
              try {
                if (file.size > 1024 * 1024)
                  throw new Error("Scenario exceeds 1 MiB")
                const imported = parseScenario(await file.text())
                const text = JSON.stringify(imported, null, 2)
                setDraft(text)
                save(text)
              } catch (reason) {
                setMessage(String(reason))
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
