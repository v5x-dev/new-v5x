<script lang="ts">
  import { Panel, useStore } from "@xyflow/svelte"
  import { Plus, Minus, Maximize, Lock, LockOpen } from "@lucide/svelte"
  import { Button } from "~/lib/components/ui/button"

  const store = useStore()
  const interactive = $derived(
    store.nodesDraggable || store.nodesConnectable || store.elementsSelectable,
  )

  function toggleInteractivity() {
    const enabled = !interactive
    store.nodesDraggable = enabled
    store.nodesConnectable = enabled
    store.elementsSelectable = enabled
  }
</script>

<Panel position="bottom-left" aria-label="Canvas controls">
  <div
    class="flex flex-col gap-1 rounded-lg border bg-background p-1 shadow-sm"
  >
    <Button
      variant="ghost"
      size="icon"
      title="Zoom in"
      aria-label="Zoom in"
      disabled={store.viewport.zoom >= store.maxZoom}
      onclick={() => store.zoomIn()}
    >
      <Plus />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      title="Zoom out"
      aria-label="Zoom out"
      disabled={store.viewport.zoom <= store.minZoom}
      onclick={() => store.zoomOut()}
    >
      <Minus />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      title="Fit view"
      aria-label="Fit view"
      onclick={() => store.fitView()}
    >
      <Maximize />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      title={interactive ? "Lock canvas" : "Unlock canvas"}
      aria-label={interactive ? "Lock canvas" : "Unlock canvas"}
      aria-pressed={!interactive}
      onclick={toggleInteractivity}
    >
      {#if interactive}<LockOpen />{:else}<Lock />{/if}
    </Button>
  </div>
</Panel>
