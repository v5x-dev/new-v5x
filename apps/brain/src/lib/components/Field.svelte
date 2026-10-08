<script lang="ts">
  export let layout: "horizontal" | "vertical" = "horizontal"
  export let label: string

  let field: HTMLLabelElement
</script>

<label
  class="field relative flex w-[calc(100%+16px)] justify-between gap-4 pe-4 [&.field.horizontal]:flex-row! [&.field.horizontal]:items-center! [&.field.vertical]:flex-col! [&.field.vertical]:justify-center! {layout}"
  bind:this={field}
>
  <slot name="handle" class="handle" />
  <span class="field-label text-sm font-semibold text-foreground">{label}</span>
  <slot />
</label>
