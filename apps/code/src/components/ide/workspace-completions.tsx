import * as React from 'react'
import { createPortal } from 'react-dom'
import type { CompletionItem } from 'vscode-languageserver-protocol'
import { Button } from '~/components/ui/button'
import { completionPosition } from '~/lib/ide/completion-position'

interface Props {
  completions: Array<CompletionItem>
  completionIndex: number
  getAnchor: () => DOMRect | undefined
  onAccept: (item: CompletionItem) => void
}

export function WorkspaceCompletions({
  completions,
  completionIndex,
  getAnchor,
  onAccept,
}: Props) {
  const popupRef = React.useRef<HTMLDivElement>(null)
  const [position, setPosition] = React.useState<ReturnType<
    typeof completionPosition
  > | null>(null)
  const open = completions.length > 0

  React.useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    let frame = 0
    let attempts = 0

    const update = () => {
      attempts += 1
      const caret = getAnchor()
      const popup = popupRef.current

      if (!caret || !popup) {
        setPosition(null)
        if (attempts < 30) frame = requestAnimationFrame(update)
        return
      }

      const next = completionPosition(
        caret,
        {
          width: popup.offsetWidth,
          height: popup.scrollHeight + popup.offsetHeight - popup.clientHeight,
        },
        { width: window.innerWidth, height: window.innerHeight },
      )
      let changed = true

      setPosition((previous) => {
        if (
          previous?.left === next.left &&
          previous.top === next.top &&
          previous.maxHeight === next.maxHeight
        ) {
          changed = false
          return previous
        }

        return next
      })

      // The applied max-height can flip the popup, so measure once more.
      if (changed && attempts < 4) frame = requestAnimationFrame(update)
    }

    const schedule = () => {
      cancelAnimationFrame(frame)
      attempts = 0
      frame = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [open, getAnchor, completions])

  if (!open) return null

  return createPortal(
    <div
      ref={popupRef}
      role="listbox"
      aria-label="Completions"
      className="no-scrollbar fixed z-50 max-h-72 w-96 max-w-[calc(100vw-1rem)] overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
      style={{ ...position, visibility: position ? 'visible' : 'hidden' }}
    >
      {completions.map((item, index) => (
        <Button
          variant="ghost"
          size="sm"
          className="flex w-full justify-start aria-selected:bg-accent"
          key={`${item.label}:${index}`}
          role="option"
          aria-selected={index === completionIndex}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onAccept(item)}
        >
          {item.label}
          <span className="ml-2 text-muted-foreground">{item.detail}</span>
        </Button>
      ))}
    </div>,
    document.body,
  )
}
