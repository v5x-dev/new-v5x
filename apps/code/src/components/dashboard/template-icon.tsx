import { cn } from "~/lib/utils"
import { templateInfo, type Template } from "./templates"

export function TemplateIcon({
  template,
  className,
  decorative = false,
}: {
  template: Template | undefined
  className?: string
  decorative?: boolean
}) {
  const info = template
    ? templateInfo[template]
    : { icon: "/favicon.svg", label: "Unknown template" }

  return (
    <img
      src={info.icon}
      alt={decorative ? "" : info.label}
      title={decorative ? undefined : info.label}
      className={cn("size-5 shrink-0 object-contain", className)}
    />
  )
}
