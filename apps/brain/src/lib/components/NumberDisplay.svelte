<script lang="ts">
  export let value: number
  export let decimals: number = 2
</script>

<div
  class="number-display w-16 overflow-x-hidden rounded border border-secondary px-[4px_0] py-0.5"
>
  {value.toFixed(decimals)}
</div>
