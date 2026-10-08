<script lang="ts">
  interface Option {
    value: string
    label: string
  }

  export let options: Option[]

  export let selected: string = options[0].value
  export let direction: "row" | "column" = "row"
</script>

<div
  role="radiogroup"
  class={direction === "row" ? "flex flex-row" : "flex flex-col"}
>
  {#each options as option}
    <input
      type="radio"
      name="radio"
      id={option.value}
      value={option.value}
      bind:group={selected}
    />
    <label for={option.value}>
      {option.label}
    </label>
  {/each}
</div>
