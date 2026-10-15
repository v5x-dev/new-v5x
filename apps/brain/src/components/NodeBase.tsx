import { useState, type ReactNode } from "react"
import { ChevronRight } from "react-feather"
import { cx } from "~/lib/utils"

export function NodeBase({
  title,
  barebones = false,
  className,
  handle,
  icon,
  children,
}: {
  title: string
  barebones?: boolean
  className?: string
  handle?: ReactNode
  icon?: ReactNode
  children?: ReactNode
}) {
  const [open, setOpen] = useState(true)

  return (
    <details
      className={cx(
        "node-base [&.node-base[open]_.caret]:transform-[rotate(90deg)]!",
        className,
      )}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="node-header relative flex h-9 w-full items-center gap-2 rounded-xl border-0 bg-muted px-[16px_12px] text-foreground [&.node-header_>_.caret]:text-foreground! [&.node-header_>_.caret]:transition-transform! [&.node-header_>_.caret]:duration-150! [&.node-header_>_.caret]:ease-[ease]! [&.node-header_>_svg]:flex-none! [&.node-header_>_svg]:text-primary! [&.node-header_strong]:flex-auto!">
        {handle}
        {icon}
        <strong className="font-normal">{title}</strong>
        <ChevronRight size="16" className="caret" />
      </summary>

      <div
        className={cx(
          "node-body flex flex-col gap-2 rounded-t-none rounded-b-xl bg-card p-4 [&.node-body.barebones]:bg-transparent!",
          barebones && "barebones",
        )}
      >
        {children}
      </div>
    </details>
  )
}
