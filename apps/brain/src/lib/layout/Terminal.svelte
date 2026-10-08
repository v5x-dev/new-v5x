<script lang="ts">
  import { onDestroy, onMount } from "svelte"

  import { Terminal } from "@xterm/xterm"
  import { FitAddon } from "@xterm/addon-fit"
  import { WebglAddon } from "@xterm/addon-webgl"

  import TerminalIcon from "svelte-feathers/Terminal.svelte"

  import { drag } from "~/lib/actions"
  import { terminal } from "~/lib/stores"

  import "@xterm/xterm/css/xterm.css"

  let fitAddon: FitAddon | undefined

  let terminalContainer: HTMLDivElement | undefined
  let monitorElement: HTMLElement | undefined

  let viewportHeight = 800
  let availableHeight = 800
  let height = "0px"
  let heightBeforeCollapse = "35vh"
  let holding = false
  let dragging = false
  let unreadMessages = 0

  const XTERM_DEFAULT_LINE_HEIGHT = 20
  const observer = new ResizeObserver(() => {
    const parent = monitorElement?.parentElement
    if (parent && monitorElement) {
      const toolbarHeight =
        parent.querySelector(".controls-header")?.getBoundingClientRect()
          .height ?? 0
      const headerHeight =
        monitorElement.querySelector("button")?.getBoundingClientRect()
          .height ?? 36
      availableHeight = Math.max(
        0,
        parent.clientHeight - toolbarHeight - headerHeight,
      )
    }
    fitAddon?.fit()
  })

  $: if (height != "0px") {
    unreadMessages = 0
  }

  onMount(() => {
    fitAddon = new FitAddon()
    $terminal = new Terminal({
      convertEol: true,
      theme: {
        background:
          localStorage.getItem("theme") === "light" ? "#ffffff" : "#252525",
        foreground:
          localStorage.getItem("theme") === "light" ? "#252525" : "#fafafa",
      },
      fontFamily: "ui-monospace, Consolas, monospace",
    })

    $terminal.loadAddon(fitAddon)
    $terminal.loadAddon(new WebglAddon())
    $terminal.open(terminalContainer!)

    $terminal?.onWriteParsed(() => {
      if (height == "0px") {
        unreadMessages++
      }
    })

    observer.observe(terminalContainer!)
    if (monitorElement?.parentElement)
      observer.observe(monitorElement.parentElement)
    fitAddon.fit()
  })

  onDestroy(() => {
    $terminal?.dispose()
    observer.disconnect()
  })

  function roundStep(number: number, step: number, offset: number = 0) {
    return Math.ceil((number - offset) / step) * step + offset
  }

  function handleDrag(event: PointerEvent) {
    if (!monitorElement) return

    const monitorRect = monitorElement.getBoundingClientRect()
    const newHeight =
      Math.max(
        roundStep(
          monitorRect.bottom -
            event.clientY -
            (monitorElement.querySelector("button")?.offsetHeight ?? 36) / 2,
          XTERM_DEFAULT_LINE_HEIGHT,
        ),
        0,
      ) + "px"

    if (height != newHeight) {
      height = newHeight
    }
  }

  function toggleCollapse() {
    if (height == "0px") {
      height = heightBeforeCollapse
    } else {
      heightBeforeCollapse = height
      height = "0px"
    }
  }
</script>

<svelte:window bind:innerHeight={viewportHeight} />

<section class="serial-monitor relative shrink-0" bind:this={monitorElement}>
  <button
    class="monitor-header flex h-9 w-full items-center rounded-t-lg rounded-b-none border-0 border-t border-secondary bg-muted px-4 font-[inherit] text-sm font-semibold transition-[background,box-shadow] duration-150 ease-[ease] outline-none [&.monitor-header_>_svg]:mr-2! [&.monitor-header_>_svg]:text-foreground! [&.monitor-header:active]:border-border! [&.monitor-header:active]:bg-accent! [&.monitor-header:focus-visible]:[box-shadow:inset_0_0_0_3px_color-mix(in_oklch,var(--primary),transparent_50%)]! [&.monitor-header:hover]:border-accent! [&.monitor-header:hover]:bg-secondary!"
    on:click={() => {
      if (!dragging) toggleCollapse()
    }}
    on:pointerdown={() => (holding = true)}
    on:pointerup={() => (holding = false)}
    on:pointermove={() => {
      if (holding) {
        dragging = true
      } else {
        dragging = false
      }
    }}
    use:drag={handleDrag}
  >
    <TerminalIcon size="16" />
    Terminal
    {#if unreadMessages}
      <span
        class="unread-messages ml-2 rounded-full bg-primary p-[1px_8px] text-xs text-background"
      >
        {unreadMessages}
      </span>
    {/if}
  </button>
  <div
    class="terminal-container h-[attr(data-height_px)] overflow-hidden bg-card [&.terminal-container_.terminal]:p-2! [&.terminal-container_::-webkit-scrollbar]:bg-[#141415]! [&.terminal-container_::-webkit-scrollbar-thumb]:border-[#141415]!"
    class:hidden={height === "0px"}
    data-height={Math.min(
      availableHeight,
      height.endsWith("vh")
        ? (parseFloat(height) * viewportHeight) / 100
        : parseFloat(height),
    )}
    bind:this={terminalContainer}
  ></div>
</section>
