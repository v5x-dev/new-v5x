import type { ReactNode } from "react"
import { cx } from "~/lib/utils"

export function Field({
  layout = "horizontal",
  label,
  handle,
  children,
}: {
  layout?: "horizontal" | "vertical"
  label: string
  handle?: ReactNode
  children?: ReactNode
}) {
  return (
    <label
      className={cx(
        "field relative flex w-[calc(100%+16px)] justify-between gap-4 pe-4 [&.field.horizontal]:flex-row! [&.field.horizontal]:items-center! [&.field.vertical]:flex-col! [&.field.vertical]:justify-center!",
        layout,
      )}
    >
      {handle}
      <span className="field-label text-sm font-semibold text-foreground">
        {label}
      </span>
      {children}
    </label>
  )
}
