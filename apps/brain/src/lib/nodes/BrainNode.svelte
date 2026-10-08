<script lang="ts">
  import { type NodeProps, type Node, Handle, Position } from "@xyflow/svelte"
  import { desktop } from "~/lib/runtime"

  import { derived, type Readable } from "svelte/store"

  import { session } from "~/lib/stores"
  import { SmartPortHandle } from "~/lib/handles"
  import { Button } from "~/lib/components/ui/button"

  import Display from "../layout/Display.svelte"
  import { Power, Upload } from "svelte-feathers"
  import Session from "../session"

  type $$Props = NodeProps<Node<NodeData>>

  type NodeData = {}

  export let data: NodeData
  void data // so svelte isnt annoying about unused exports
  export let id: $$Props["id"]

  let fileInput: HTMLInputElement
  let error = ""
  let loading = false
  const programName = derived(
    session,
    (value) =>
      value?.binary
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.bin$/, "") ?? "",
  )
  async function load(binary: string, file?: File) {
    if (loading) return
    loading = true
    error = ""
    try {
      await $session?.stop()
      $session = new Session(binary, file)
      await $session.start()
    } catch (reason) {
      error = String(reason)
      $session = null
    } finally {
      loading = false
    }
  }
  async function loadExample() {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}example.bin`)
      if (!response.ok) throw new Error("Could not load example")
      const file = new File([await response.blob()], "example.bin")
      await load(file.name, file)
    } catch (reason) {
      error = String(reason)
    }
  }
  async function handleButtonClick() {
    if (loading) return
    if ($session?.running) {
      await $session.stop()
      $session = null
    } else fileInput.click()
  }
</script>

<input
  type="file"
  accept=".bin"
  aria-label="Upload program binary"
  class="hidden"
  bind:this={fileInput}
  on:change={() => {
    const file = fileInput.files?.[0]
    if (file) void load(file.name, file)
    fileInput.value = ""
  }}
/>
{#if error}<p role="alert" class="absolute top-15 z-5 bg-[#191919] p-3">
    {error}
  </p>{/if}
<div
  class="ports ports-top absolute left-18 z-1 flex w-107.5 justify-evenly [&.ports_>_.svelte-flow\_\_handle]:relative! [&.ports_>_.svelte-flow\_\_handle]:top-0! [&.ports_>_.svelte-flow\_\_handle]:left-0! [&.ports_>_.svelte-flow\_\_handle]:transform-none!"
>
  {#each { length: 10 } as _, n}
    <div
      class="smart-port relative flex justify-center [&.smart-port_.smart-port-handle]:top-0! [&.smart-port_.smart-port-handle]:left-0! [&.smart-port_.smart-port-handle]:h-full! [&.smart-port_.smart-port-handle]:w-full! [&.smart-port_.smart-port-handle]:transform-none! [&.smart-port_.smart-port-handle]:opacity-0! [&.smart-port_svg]:block!"
    >
      <span
        class="smart-port-label absolute h-5.5 w-5.5 rounded border-[1.5px] border-current text-center text-xs leading-5 text-muted-foreground"
        >{n + 1}</span
      >
      <SmartPortHandle
        id={`${n + 1}`}
        parentNode={id}
        type="target"
        position={Position.Top}
      />
      <svg
        class="smart-port-indicator"
        width="37"
        height="35"
        viewBox="0 0 37 35"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M4.99994 1L32 1C34.2091 1 36 2.79086 36 5L36 24H31V29H26V34H11V29H5.99999L6 24H0.999939V5C0.999939 2.79086 2.7908 1 4.99994 1Z"
          stroke="var(--secondary)"
          fill="var(--border)"
        />
      </svg>
    </div>
    {#if n == 4}
      <div class="ports-spacer w-5"></div>
    {/if}
  {/each}
</div>
{#if !desktop && !$session?.running}
  <Button
    variant="default"
    class="button absolute -bottom-9 left-20 z-3"
    disabled={loading}
    onclick={loadExample}>{loading ? "Starting…" : "Run example"}</Button
  >
{/if}
<div
  class="housing-inner absolute flex h-88.75 w-164.5 items-center justify-between rounded-3xl border border-secondary bg-muted px-[60px_18px] transition-all duration-150 ease-[ease] [&.housing-inner_.button]:h-16! [&.housing-inner_.button]:w-16! [&.housing-inner_.button]:rounded-[6px]! [&.housing-inner_.button]:p-0!"
>
  <Display programName={$programName} />
  <Button
    variant="secondary"
    title={$session?.running ? "Unload program" : "Upload program"}
    class="button rounded-2xl! border! border-border! [&_svg]:size-8!"
    onclick={handleButtonClick}
  >
    {#if $session?.running}
      <Power size="24" />
    {:else}
      <Upload size="24" />
    {/if}
  </Button>
</div>
<div class="housing-inner-focus-outline"></div>
<div
  class="ports ports-bottom absolute left-18 z-1 flex w-107.5 justify-evenly [&.ports_>_.svelte-flow\_\_handle]:relative! [&.ports_>_.svelte-flow\_\_handle]:top-0! [&.ports_>_.svelte-flow\_\_handle]:left-0! [&.ports_>_.svelte-flow\_\_handle]:transform-none!"
>
  {#each { length: 10 } as _, n}
    <div
      class="smart-port relative flex justify-center [&.smart-port_.smart-port-handle]:top-0! [&.smart-port_.smart-port-handle]:left-0! [&.smart-port_.smart-port-handle]:h-full! [&.smart-port_.smart-port-handle]:w-full! [&.smart-port_.smart-port-handle]:transform-none! [&.smart-port_.smart-port-handle]:opacity-0! [&.smart-port_svg]:block!"
    >
      <span
        class="smart-port-label absolute h-5.5 w-5.5 rounded border-[1.5px] border-current text-center text-xs leading-5 text-muted-foreground"
        >{n + 11}</span
      >
      <SmartPortHandle
        id={`${n + 11}`}
        parentNode={id}
        type="target"
        position={Position.Bottom}
      />
      <svg
        width="37"
        height="35"
        viewBox="0 0 37 35"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M32.0001 34H5.00002C2.79088 34 1.00002 32.2091 1.00002 30L1 11H6.00002V6H11V1H26V6H31L31 11H36.0001V30C36.0001 32.2091 34.2092 34 32.0001 34Z"
          stroke="var(--secondary)"
          fill="var(--border)"
        />
      </svg>
    </div>
    {#if n == 4}
      <div class="ports-spacer w-5"></div>
    {/if}
  {/each}
</div>
<div
  class="port-21 absolute top-25 right-0 flex items-center [&.port-21_.smart-port-label]:right-3!"
>
  <span
    class="smart-port-label absolute h-5.5 w-5.5 rounded border-[1.5px] border-current text-center text-xs leading-5 text-muted-foreground"
    >21</span
  >
  <SmartPortHandle
    id="21"
    parentNode={id}
    type="target"
    position={Position.Right}
  />
</div>

<Handle
  id="battery_port"
  class="battery-port top-[66.66%]!"
  type="target"
  isConnectable={false}
  position={Position.Right}
/>
<SmartPortHandle
  id="onboard_adi"
  parentNode={id}
  type="target"
  position={Position.Left}
/>
