import type { SVGProps } from "react"

export function VisionSensor({
  size = 24,
  ...props
}: Omit<SVGProps<SVGSVGElement>, "width" | "height"> & {
  size?: number | string
}) {
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="10" y="6" width="4" height="4" rx="1" fill="var(--primary)" />
      <path
        d="M7 4V10C7 11.6569 8.34315 13 10 13H14C15.6569 13 17 11.6569 17 10V4"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect
        x="1"
        y="3"
        width="22"
        height="18"
        rx="3"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  )
}
