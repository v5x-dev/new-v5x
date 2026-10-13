<script lang="ts">
  import ScenarioControls from "./ScenarioControls.svelte"
  import { Button } from "~/lib/components/ui/button"
  import { Download, Upload } from "@lucide/svelte"
  import { nodes, edges, session, installConfiguration } from "~/lib/stores"
  import {
    parseConfiguration,
    simulationConfiguration,
  } from "~/lib/configuration"

  let fileInput: HTMLInputElement
  let error = ""
  let importing = false

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
<ScenarioControls />
<input
  type="file"
  accept=".json"
  aria-label="Import wiring file"
  class="hidden"
  bind:this={fileInput}
  on:change={importConfiguration}
/>
{#if error}<p role="alert">{error}</p>{/if}
