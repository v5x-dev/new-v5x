<script lang="ts">
  export let title: string
  export let barebones = false
  export let open = true

  import { ChevronRight } from "svelte-feathers"

  let className = ""
  export { className as class }
</script>

<details
  class="node-base [&.node-base[open]_.caret]:transform-[rotate(90deg)]! {className}"
  bind:open
>
  <summary
    class="node-header relative flex h-9 w-full items-center gap-2 rounded-xl border-0 bg-muted px-[16px_12px] text-foreground [&.node-header_>_.caret]:text-foreground! [&.node-header_>_.caret]:transition-transform! [&.node-header_>_.caret]:duration-150! [&.node-header_>_.caret]:ease-[ease]! [&.node-header_>_svg]:flex-none! [&.node-header_>_svg]:text-primary! [&.node-header_strong]:flex-auto!"
  >
    <slot name="handle" />
    <slot name="icon" />
    <strong class="font-normal">{title}</strong>
    <ChevronRight size="16" class="caret" />
  </summary>

  <div
    class="node-body flex flex-col gap-2 rounded-t-none rounded-b-xl bg-card p-4 [&.node-body.barebones]:bg-transparent!"
    class:barebones
  >
    <slot />
  </div>
</details>
