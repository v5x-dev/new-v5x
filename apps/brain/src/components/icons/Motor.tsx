import type { SVGProps } from "react"

export function Motor({
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
      <rect
        x="5"
        y="3"
        width="18"
        height="18"
        rx="3"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect
        x="1"
        y="12"
        width="4"
        height="6"
        rx="1"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect x="9" y="4" width="2" height="16" fill="currentColor" />
      <path
        d="M0 7.5C0 7.22386 0.223858 7 0.5 7H4V9H0.5C0.223858 9 0 8.77614 0 8.5V7.5Z"
        fill="var(--primary)"
      />
    </svg>
  )
}
