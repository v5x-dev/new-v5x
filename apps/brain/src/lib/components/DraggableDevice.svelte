<script lang="ts">
  import { Button } from "~/lib/components/ui/button"

  export let name: string
  export let onmousedown: (event: MouseEvent) => void = () => {}
</script>

<Button
  variant="secondary"
  size="sm"
  class="button small draggable draggable-device [&.draggable-device_>_svg]:h-auto! [&.draggable-device_>_svg]:w-4! [&.draggable-device_>_svg]:text-foreground!"
  title="{name} (double-click or drag)"
  {onmousedown}
>
  <slot name="icon" />
  <span class="device-name">{name}</span>
</Button>
