import type { ComponentProps } from "react"
import { Input } from "~/components/ui/input"

/** A number input that only reports values the browser parsed as numbers. */
export function NodeNumberInput({
  value,
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number
  onValueChange: (value: number) => void
}) {
  return (
    <Input
      type="number"
      value={Number.isNaN(value) ? "" : value}
      onChange={(event) => {
        const next = event.currentTarget.valueAsNumber
        if (Number.isFinite(next)) onValueChange(next)
      }}
      {...props}
    />
  )
}
