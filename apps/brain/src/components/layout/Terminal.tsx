import { FitAddon } from "@xterm/addon-fit"
import { WebglAddon } from "@xterm/addon-webgl"
import { Terminal as XTerm } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { useEffect, useRef, useState } from "react"
import { Terminal as TerminalIcon } from "react-feather"
import { useDrag } from "~/hooks/use-drag"
import { setTerminal } from "~/lib/stores"
import { getTerminalTheme } from "~/lib/terminal-theme"

const XTERM_DEFAULT_LINE_HEIGHT = 20

function roundStep(number: number, step: number, offset: number = 0) {
  return Math.ceil((number - offset) / step) * step + offset
}

export function Terminal() {
  const terminalContainer = useRef<HTMLDivElement>(null)
  const monitorElement = useRef<HTMLElement>(null)
  const fitAddon = useRef<FitAddon | undefined>(undefined)

  const [viewportHeight, setViewportHeight] = useState(window.innerHeight)
  const [availableHeight, setAvailableHeight] = useState(800)
  const [height, setHeight] = useState("0px")
  const [unreadMessages, setUnreadMessages] = useState(0)
  const heightBeforeCollapse = useRef("35vh")
  const heightRef = useRef(height)
  heightRef.current = height
  const holding = useRef(false)
  const dragging = useRef(false)

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useEffect(() => {
    if (height !== "0px") setUnreadMessages(0)
  }, [height])

  useEffect(() => {
    const container = terminalContainer.current!
    const monitor = monitorElement.current

    const fit = new FitAddon()
    fitAddon.current = fit
    const terminal = new XTerm({
      convertEol: true,
      theme: getTerminalTheme(),
      fontFamily: "ui-monospace, Consolas, monospace",
    })
    terminal.loadAddon(fit)
    terminal.loadAddon(new WebglAddon())
    terminal.open(container)
    setTerminal(terminal)

    terminal.onWriteParsed(() => {
      if (heightRef.current === "0px") setUnreadMessages((count) => count + 1)
    })

    const observer = new ResizeObserver(() => {
      const parent = monitor?.parentElement
      if (parent && monitor) {
        const toolbarHeight =
          parent.querySelector(".controls-header")?.getBoundingClientRect()
            .height ?? 0
        const headerHeight =
          monitor.querySelector("button")?.getBoundingClientRect().height ?? 36
        setAvailableHeight(
          Math.max(0, parent.clientHeight - toolbarHeight - headerHeight),
        )
      }
      fit.fit()
    })
    observer.observe(container)
    if (monitor?.parentElement) observer.observe(monitor.parentElement)
    fit.fit()

    return () => {
      observer.disconnect()
      setTerminal(null)
      terminal.dispose()
    }
  }, [])

  function handleDrag(event: PointerEvent) {
    const monitor = monitorElement.current
    if (!monitor) return

    const monitorRect = monitor.getBoundingClientRect()
    const newHeight =
      Math.max(
        roundStep(
          monitorRect.bottom -
            event.clientY -
            (monitor.querySelector("button")?.offsetHeight ?? 36) / 2,
          XTERM_DEFAULT_LINE_HEIGHT,
        ),
        0,
      ) + "px"

    setHeight(newHeight)
  }

  function toggleCollapse() {
    if (height === "0px") {
      setHeight(heightBeforeCollapse.current)
    } else {
      heightBeforeCollapse.current = height
      setHeight("0px")
    }
  }

  const dragRef = useDrag<HTMLButtonElement>(handleDrag)

  const containerHeight = Math.min(
    availableHeight,
    height.endsWith("vh")
      ? (parseFloat(height) * viewportHeight) / 100
      : parseFloat(height),
  )

  return (
    <section className="serial-monitor relative shrink-0" ref={monitorElement}>
      <button
        ref={dragRef}
        className="monitor-header flex h-9 w-full items-center rounded-t-lg rounded-b-none border-0 border-t border-secondary bg-muted px-4 font-[inherit] text-sm font-semibold transition-[background,box-shadow] duration-150 ease-[ease] outline-none [&.monitor-header_>_svg]:mr-2! [&.monitor-header_>_svg]:text-foreground! [&.monitor-header:active]:border-border! [&.monitor-header:active]:bg-accent! [&.monitor-header:focus-visible]:[box-shadow:inset_0_0_0_3px_color-mix(in_oklch,var(--primary),transparent_50%)]! [&.monitor-header:hover]:border-accent! [&.monitor-header:hover]:bg-secondary!"
        onClick={() => {
          if (!dragging.current) toggleCollapse()
        }}
        onPointerDown={() => {
          holding.current = true
        }}
        onPointerUp={() => {
          holding.current = false
        }}
        onPointerMove={() => {
          dragging.current = holding.current
        }}
      >
        <TerminalIcon size="16" />
        Terminal
        {unreadMessages > 0 && (
          <span className="unread-messages ml-2 rounded-full bg-primary p-[1px_8px] text-xs text-background">
            {unreadMessages}
          </span>
        )}
      </button>
      <div
        className={
          "terminal-container overflow-hidden bg-card [&.terminal-container_.terminal]:p-2!" +
          (height === "0px" ? " hidden" : "")
        }
        style={{ height: containerHeight }}
        ref={terminalContainer}
      ></div>
    </section>
  )
}
