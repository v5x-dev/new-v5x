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
    const update = () => {
      const caret = getAnchor()
      const popup = popupRef.current

      if (caret && popup) {
        const next = completionPosition(
          caret,
          {
            width: popup.offsetWidth,
            height:
              popup.scrollHeight + popup.offsetHeight - popup.clientHeight,
          },
          { width: window.innerWidth, height: window.innerHeight },
        )
        setPosition((previous) =>
          previous?.left === next.left &&
          previous.top === next.top &&
          previous.maxHeight === next.maxHeight
            ? previous
            : next,
        )
      } else {
        setPosition(null)
      }

      frame = requestAnimationFrame(update)
    }

    update()
    return () => cancelAnimationFrame(frame)
  }, [open, getAnchor])

  if (!open) return null

  return createPortal(
    <div
      ref={popupRef}
      role="listbox"
      aria-label="Completions"
      className="fixed z-50 max-h-72 w-96 max-w-[calc(100vw-1rem)] overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
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
