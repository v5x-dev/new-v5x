import type { ReactNode } from "react"

export function Toolbar({
  left,
  right,
}: {
  left?: ReactNode
  right?: ReactNode
}) {
  return (
    <header className="controls-header relative flex h-11.5 shrink-0 items-center bg-sidebar px-2">
      <div className="controls-left flex flex-auto gap-2">{left}</div>
      <div className="controls-right flex flex-none gap-2">{right}</div>
    </header>
  )
}
