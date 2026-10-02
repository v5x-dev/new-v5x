import * as React from 'react'

export function LspDialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  const ref = React.useRef<HTMLDialogElement>(null)
  React.useEffect(() => {
    const dialog = ref.current!
    if (!dialog.open) dialog.showModal()
    return () => {
      dialog.close()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={`fixed inset-0 m-auto max-h-[85vh] overflow-hidden rounded-lg border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50 ${wide ? 'w-[min(90vw,72rem)]' : 'w-[min(90vw,44rem)]'}`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose()
      }}
    >
      <div className="flex max-h-[calc(85vh-2px)] min-h-0 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
            {title}
          </h2>
          <button
            className="rounded px-2 py-1 text-sm hover:bg-accent"
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            Close
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
