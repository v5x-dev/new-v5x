export { cn } from "cn"

/**
 * Join class names without merging. `cn` resolves conflicts between Tailwind
 * utilities, which drops one of the arbitrary-variant utilities the canvas
 * components set together (for example a font family and a font weight).
 */
export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ")
}
