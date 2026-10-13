import type { ITheme } from "@xterm/xterm"

function colorToRgb(color: string, context: CanvasRenderingContext2D) {
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)

  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
  return [red, green, blue] as const
}

function colorToHex(color: string, context: CanvasRenderingContext2D) {
  const channels = colorToRgb(color, context)
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
}

export function getTerminalTheme(): ITheme {
  const rootStyles = getComputedStyle(document.documentElement)
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d", { willReadFrequently: true })

  if (!context) {
    return {
      background: "#ffffff",
      foreground: "#252525",
    }
  }

  const color = (token: string) =>
    rootStyles.getPropertyValue(`--${token}`).trim()
  const foreground = colorToHex(color("foreground"), context)
  const primary = color("primary")
  const [red, green, blue] = colorToRgb(primary, context)

  return {
    background: colorToHex(color("card"), context),
    foreground,
    cursor: colorToHex(primary, context),
    cursorAccent: colorToHex(color("primary-foreground"), context),
    selectionBackground: `rgba(${red}, ${green}, ${blue}, 0.3)`,
    selectionForeground: colorToHex(color("primary-foreground"), context),
  }
}
