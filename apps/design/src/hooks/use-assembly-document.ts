import { useEffect, useReducer, useRef, useState } from "react"
import { modelPathSet } from "#/lib/parts"
import {
  assemblyHistory,
  editAssembly,
  parseAssembly,
  type AssemblyDocument,
  type AssemblyPart,
} from "#/lib/assembly"
import { HOLES } from "#/lib/holes"

export type TransformMode = "translate" | "rotate"

export function useAssemblyDocument() {
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<TransformMode>("translate")
  const [renderHoles, setRenderHoles] = useState(false)
  const dragging = useRef(false)
  const setDragging = (value: boolean) => {
    dragging.current = value
  }

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

  const importDocument = (document: AssemblyDocument) => {
    restoreFailed.current = false
    setSaveError("")
    dispatch({ type: "replace", document })
    setSelectedId(null)
  }

  const addPart = (path: string) => {
    if (!modelPathSet.has(path)) return false
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
    return true
  }

  const mateHole = (part: AssemblyPart, hole: number) => {
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
  }

  return {
    history,
    dispatch,
    parts,
    saveError,
    selectedId,
    setSelectedId,
    mode,
    setMode,
    renderHoles,
    setRenderHoles,
    dragging,
    setDragging,
    importDocument,
    addPart,
    mateHole,
  }
}
