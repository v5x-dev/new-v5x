<script lang="ts">
  import { type NodeProps, type Node, Position } from "@xyflow/svelte"
  import { useHandleConnections } from "~/lib/flow-hooks.svelte"
  import { SmartPortHandle } from "~/lib/handles"

  type NodeData = Record<string, never>
  type $$Props = NodeProps<Node<NodeData>>

  export let data: NodeData
  export let id: $$Props["id"]
  void data

  const connections = useHandleConnections({
    nodeId: id,
    type: "source",
    id: "smart_port_connector",
  })
</script>

<div class="motor" aria-label="V5 Smart Motor">
  <div class="port">
    <span class="dot" class:on={$connections.length > 0}></span>
    <SmartPortHandle
      id="connector"
      parentNode={id}
      type="source"
      position={Position.Right}
    />
  </div>

  <div class="housing">
    <div class="fins" aria-hidden="true">
      {#each { length: 11 } as _}
        <span></span>
      {/each}
    </div>
  </div>
  <div class="posts" aria-hidden="true">
    <span></span>
    <span></span>
  </div>
</div>

<style>
  .motor {
    position: relative;
    width: 172px;
    height: 188px;
  }

  .housing {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    width: 164px;
    height: 164px;
    border: 1px solid var(--secondary);
    border-radius: 18px;
    background: var(--muted);
  }

  .fins {
    position: absolute;
    top: 34px;
    left: 14px;
    display: flex;
    justify-content: space-between;
    width: 76px;
    height: 92px;
  }

  .fins span {
    width: 2px;
    border-radius: 999px;
    background: var(--border);
  }

  .posts {
    position: absolute;
    top: 156px;
    left: 36px;
    display: flex;
    gap: 10px;
  }

  .posts span {
    width: 22px;
    height: 24px;
    box-sizing: border-box;
    border: 1px solid var(--secondary);
    border-top: 0;
    border-radius: 0;
    background: var(--muted);
  }

  .port {
    position: absolute;
    top: 76px;
    left: 158px;
    z-index: 2;
    width: 12px;
    height: 12px;
  }

  .dot {
    display: block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: color-mix(in oklch, var(--foreground) 55%, var(--muted));
  }

  .dot.on {
    background: #ff3030;
  }

  .port :global(.smart-port-handle) {
    top: 0 !important;
    left: 0 !important;
    width: 12px !important;
    height: 12px !important;
    min-width: 0 !important;
    min-height: 0 !important;
    transform: none !important;
    border-radius: 50% !important;
    opacity: 0 !important;
  }
</style>
