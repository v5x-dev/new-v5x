<script lang="ts">
  import { onDestroy } from "svelte"
  import { distanceScenario, scenarioFrame } from "~/lib/scenarios"
  import { Button } from "~/lib/components/ui/button"
  import { Download, Play, Square, Upload } from "@lucide/svelte"
  import { nodes, edges, session, installConfiguration } from "~/lib/stores"
  import {
    parseConfiguration,
    simulationConfiguration,
  } from "~/lib/configuration"

  let fileInput: HTMLInputElement
  let error = ""
  let importing = false

  let scenarioTimer: ReturnType<typeof setTimeout> | undefined
  let scenarioRunning = false
  let scenarioStep = 0

  function stopScenario() {
    clearTimeout(scenarioTimer)
    scenarioRunning = false
  }

  function runScenarioStep() {
    if (!$session?.running) return stopScenario()
    try {
      const frame = distanceScenario[scenarioStep]!
      nodes.update((current) => scenarioFrame(current, $edges, frame.at))
      scenarioStep++
      if (scenarioStep === distanceScenario.length) return stopScenario()
      scenarioTimer = setTimeout(runScenarioStep, 1000)
    } catch (reason) {
      error = String(reason)
      stopScenario()
    }
  }

  function startScenario() {
    error = ""
    scenarioStep = 0
    scenarioRunning = true
    runScenarioStep()
  }

  onDestroy(stopScenario)

  function exportConfiguration() {
    const blob = new Blob(
      [JSON.stringify(simulationConfiguration($nodes, $edges), null, 2)],
      { type: "application/json" },
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "wiring.v5x.json"
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function importConfiguration() {
    const file = fileInput.files?.[0]
    fileInput.value = ""
    if (!file || importing) return
    importing = true
    error = ""
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error("Configuration exceeds 8 MiB")
      const configuration = parseConfiguration(await file.text())
      stopScenario()
      await $session?.stop()
      installConfiguration(configuration)
    } catch (reason) {
      error = String(reason)
    } finally {
      importing = false
    }
  }
</script>

<Button
  variant="ghost"
  size="icon"
  title="Export wiring"
  aria-label="Export wiring"
  onclick={exportConfiguration}
>
  <Download size="16" />
</Button>
<Button
  variant="ghost"
  size="icon"
  title="Import wiring"
  aria-label="Import wiring"
  disabled={importing}
  onclick={() => fileInput.click()}
>
  <Upload size="16" />
</Button>
<Button
  variant="ghost"
  size="icon"
  title={scenarioRunning ? "Stop scenario" : "Replay distance scenario"}
  aria-label={scenarioRunning ? "Stop scenario" : "Replay distance scenario"}
  disabled={!$session?.running}
  onclick={() => (scenarioRunning ? stopScenario() : startScenario())}
>
  {#if scenarioRunning}
    <Square size="16" />
  {:else}
    <Play size="16" />
  {/if}
</Button>
<input
  type="file"
  accept=".json"
  aria-label="Import wiring file"
  class="hidden"
  bind:this={fileInput}
  on:change={importConfiguration}
/>
{#if error}<p role="alert">{error}</p>{/if}
