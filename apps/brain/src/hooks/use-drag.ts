import { useCallback, useRef } from "react"

/**
 * Capture a pointer on the element and stream its moves to the callback until
 * released. Returns a ref callback to attach to the draggable element.
 */
export function useDrag<T extends HTMLElement>(
  callback: (event: PointerEvent) => void,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const cleanup = useRef<(() => void) | undefined>(undefined)

  return useCallback((node: T | null) => {
    cleanup.current?.()
    cleanup.current = undefined
    if (!node) return

    const onMove = (event: PointerEvent) => callbackRef.current(event)

    const onPointerDown = (event: PointerEvent) => {
      if (
        (event.pointerType === "mouse" && event.button === 2) ||
        (event.pointerType !== "mouse" && !event.isPrimary)
      )
        return

      node.setPointerCapture(event.pointerId)
      event.preventDefault()

      const onPointerUp = (upEvent: PointerEvent) => {
        node.releasePointerCapture(upEvent.pointerId)
        window.removeEventListener("pointermove", onMove, false)
        window.removeEventListener("pointerup", onPointerUp, false)
      }

      window.addEventListener("pointermove", onMove, false)
      window.addEventListener("pointerup", onPointerUp, false)
    }

    node.addEventListener("pointerdown", onPointerDown, {
      capture: true,
      passive: false,
    })
    cleanup.current = () =>
      node.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      })
  }, [])
}
