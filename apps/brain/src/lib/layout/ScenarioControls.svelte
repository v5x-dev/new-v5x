<script lang="ts">
  import { onDestroy, onMount } from "svelte"
  import { get } from "svelte/store"
  import { Button } from "~/lib/components/ui/button"
  import * as Dialog from "~/lib/components/ui/dialog"
  import { nodes, edges, session } from "~/lib/stores"
  import { listen } from "~/lib/runtime"
  import { distanceScenario } from "~/lib/scenarios"
  import {
    applyScenarioFrame,
    captureFrame,
    emptyScenario,
    parseScenario,
    ScenarioOutput,
    scenarioKey,
    type SavedScenario,
  } from "~/lib/saved-scenarios"

  let open = false
  let scenario: SavedScenario = emptyScenario()
  let draft = JSON.stringify(scenario, null, 2)
  let at = 0
  let message = ""
  let running = false
  let starting = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let unlisten: (() => void)[] = []
  let original: typeof $nodes | undefined
  let fileInput: HTMLInputElement
  let generation = 0
  let restartPending = false

  onMount(() => {
    try {
      const stored = localStorage.getItem(scenarioKey)
      if (stored) {
        scenario = parseScenario(stored)
        draft = JSON.stringify(scenario, null, 2)
      }
    } catch (reason) {
      message = `Unable to restore scenario: ${String(reason)}`
    }
  })

  function stop(restore = true) {
    generation++
    clearTimeout(timer)
    unlisten.splice(0).forEach((fn) => fn())
    if (restore && original) nodes.set(original)
    original = undefined
    running = false
    if (!restartPending) starting = false
  }
  onDestroy(() => stop(false))

  function save() {
    scenario = parseScenario(draft)
    localStorage.setItem(scenarioKey, JSON.stringify(scenario))
    message = "Scenario saved in this browser"
  }

  function capture() {
    try {
      const editable = JSON.parse(draft) as SavedScenario
      editable.frames = [
        ...editable.frames.filter((frame) => frame.at !== at),
        captureFrame($nodes, $edges, at),
      ].sort((a, b) => a.at - b.at)
      scenario = parseScenario(JSON.stringify(editable))
      draft = JSON.stringify(scenario, null, 2)
      at += 1000
      message = "Captured current distance and controller settings"
    } catch (reason) {
      message = String(reason)
    }
  }

  function distanceExample() {
    try {
      const captured = captureFrame($nodes, $edges, 0)
      if (!captured.distances.length)
        throw new Error("Connect a distance sensor to a Brain smart port first")
      scenario = {
        version: 1,
        name: "Distance approach",
        frames: distanceScenario.map((frame) => ({
          ...captured,
          at: frame.at,
          distances: captured.distances.map((sensor) => ({
            ...sensor,
            distance: frame.distance,
            visible: frame.visible,
          })),
        })),
        expectations: [],
      }
      draft = JSON.stringify(scenario, null, 2)
      message = "Distance example loaded. Add output checks for your program."
    } catch (reason) {
      message = String(reason)
    }
  }

  async function replay() {
    try {
      save()
      const active = get(session)
      if (!active?.running) throw new Error("Load a program before replaying")
      // Validate every target before resetting the running program.
      for (const frame of scenario.frames)
        applyScenarioFrame($nodes, $edges, frame)
      stop()
      const run = generation
      starting = true
      restartPending = true
      original = $nodes
      if (scenario.frames[0].at === 0)
        nodes.set(applyScenarioFrame($nodes, $edges, scenario.frames[0]))
      await active.stop()
      if (run !== generation) return
      const output = new ScenarioOutput(scenario.expectations)
      let started: number | undefined
      const detachOutput = await listen<number[]>(
        "brain_usb_recv",
        ({ payload }) =>
          output.push(
            new Uint8Array(payload),
            started === undefined ? 0 : performance.now() - started,
          ),
      )
      if (run !== generation) {
        detachOutput()
        return
      }
      unlisten.push(detachOutput)
      await active.start()
      if (run !== generation) return
      started = performance.now()
      starting = false
      running = true
      const duration = Math.max(
        scenario.frames.at(-1)!.at,
        ...scenario.expectations.map((item) => item.by),
      )
      let step = 0
      function tick() {
        if (run !== generation) return
        if (!get(session)?.running || get(session)?.paused) {
          stop()
          message = "Scenario stopped because program stopped or paused"
          return
        }
        const elapsed = performance.now() - started!
        try {
          while (
            step < scenario.frames.length &&
            scenario.frames[step]!.at <= elapsed
          ) {
            nodes.update((current) =>
              applyScenarioFrame(current, get(edges), scenario.frames[step]!),
            )
            step++
          }
        } catch (reason) {
          stop()
          message = String(reason)
          return
        }
        if (elapsed >= duration) {
          const results = output.results()
          stop()
          message = results.length
            ? results
                .map(
                  (item) =>
                    `${item.passed ? "PASS" : "FAIL"}: "${item.text}" by ${item.by} ms`,
                )
                .join("\n")
            : "Replay complete. No output checks configured."
        } else timer = setTimeout(tick, Math.min(25, duration - elapsed))
      }
      tick()
    } catch (reason) {
      stop()
      message = String(reason)
    } finally {
      restartPending = false
      starting = false
    }
  }

  function exportScenario() {
    try {
      save()
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(scenario, null, 2)], {
          type: "application/json",
        }),
      )
      const link = document.createElement("a")
      link.href = url
      link.download = "scenario.v5x.json"
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (reason) {
      message = String(reason)
    }
  }
</script>

<Button variant="ghost" size="sm" onclick={() => (open = true)}
  >Scenarios</Button
>
<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[90vh] overflow-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Simulation scenarios</Dialog.Title>
      <Dialog.Description
        >Set device values on the canvas, then capture frames. Replay restarts
        the program and restores your device settings afterward. Output checks
        match text printed by your program before a deadline.</Dialog.Description
      >
    </Dialog.Header>
    <label class="flex flex-col gap-1"
      >Frame time in milliseconds
      <input
        class="rounded-md border bg-background p-2"
        type="number"
        min="0"
        max="600000"
        step="1000"
        bind:value={at}
        disabled={running || starting}
      />
    </label>
    <Button variant="outline" onclick={capture} disabled={running || starting}
      >Capture device settings</Button
    >
    <label class="flex flex-col gap-1"
      >Scenario timeline
      <textarea
        class="h-64 rounded-md border bg-background p-2 font-mono"
        aria-label="Scenario timeline"
        bind:value={draft}
        disabled={running || starting}></textarea>
    </label>
    <p>
      To check output, add an expectation such as {JSON.stringify({
        by: 5000,
        text: "READY",
      })} to the expectations list. Frames target distance sensors by smart port and
      controllers by ID.
    </p>
    <div class="flex flex-wrap gap-2">
      <Button
        variant="outline"
        onclick={distanceExample}
        disabled={running || starting}>Use distance example</Button
      >
      <Button
        onclick={() => {
          try {
            save()
          } catch (reason) {
            message = String(reason)
          }
        }}
        disabled={running || starting}>Save scenario</Button
      >
      <Button
        variant="outline"
        onclick={exportScenario}
        disabled={running || starting}>Export scenario</Button
      >
      <Button
        variant="outline"
        onclick={() => fileInput.click()}
        disabled={running || starting}>Import scenario</Button
      >
      <Button
        onclick={() => void replay()}
        disabled={!$session?.running || running || starting}
        >Replay from start</Button
      >
      {#if running || starting}<Button
          variant="outline"
          onclick={() => {
            stop()
            message = "Replay cancelled"
          }}>Stop replay</Button
        >{/if}
    </div>
    <p role="status" class="whitespace-pre-wrap">
      {running
        ? "Replaying scenario…"
        : starting
          ? "Restarting program…"
          : message}
    </p>
    <input
      class="hidden"
      type="file"
      accept=".json"
      aria-label="Import scenario file"
      bind:this={fileInput}
      onchange={async () => {
        const file = fileInput.files?.[0]
        fileInput.value = ""
        if (!file) return
        try {
          if (file.size > 1024 * 1024) throw new Error("Scenario exceeds 1 MiB")
          const imported = parseScenario(await file.text())
          draft = JSON.stringify(imported, null, 2)
          save()
        } catch (reason) {
          message = String(reason)
        }
      }}
    />
  </Dialog.Content>
</Dialog.Root>
