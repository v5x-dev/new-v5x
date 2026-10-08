<script lang="ts">
  import { type NodeProps, type Node, Position } from "@xyflow/svelte"
  import { SmartPortHandle, AdiPortHandle } from "~/lib/handles"

  type NodeData = {
    onboard: boolean
  }

  type $$Props = NodeProps<Node<NodeData>>

  export let data: NodeData
  export let id: $$Props["id"]
</script>

<div
  class="adi-inner flex w-50 items-center justify-center p-4 [&.adi-inner.onboard]:h-50! [&.adi-inner.onboard]:w-auto! [&.adi-inner.onboard_.ports]:top-[50%]! [&.adi-inner.onboard_.ports]:left-0! [&.adi-inner.onboard_.ports]:h-full! [&.adi-inner.onboard_.ports]:w-auto! [&.adi-inner.onboard_.ports]:transform-[translateX(-50%)_translateY(-50%)]! [&.adi-inner.onboard_.ports]:flex-col!"
  class:onboard={data.onboard}
>
  ADI
  <SmartPortHandle
    id="connector"
    parentNode={id}
    type="source"
    position={data.onboard ? Position.Right : Position.Bottom}
  />
  <div
    class="ports absolute top-0 left-[50%] flex w-full transform-[translateX(-50%)_translateY(-50%)] justify-evenly [&.ports_>_.svelte-flow\_\_handle]:relative! [&.ports_>_.svelte-flow\_\_handle]:top-0! [&.ports_>_.svelte-flow\_\_handle]:left-0! [&.ports_>_.svelte-flow\_\_handle]:transform-none!"
  >
    {#each ["a", "b", "c", "d", "e", "f", "g", "h"] as port}
      <AdiPortHandle
        id={port}
        parentNode={id}
        type="target"
        position={data.onboard ? Position.Left : Position.Top}
      />
    {/each}
  </div>
</div>
