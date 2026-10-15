import { Position, type Node, type NodeProps } from "@xyflow/react"
import { Field } from "~/components/Field"
import { ConnectorHandle } from "~/components/handles"
import { Controller } from "~/components/icons"
import { NodeBase } from "~/components/NodeBase"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { updateNodeData, useApp } from "~/lib/stores"
import { cx } from "~/lib/utils"

type ControllerData = {
  controllerId?: number
  axis1?: number
  axis2?: number
  axis3?: number
  axis4?: number
  buttons?: number
  capacity?: number
  connected?: boolean
}

const buttonInputs = [
  ["L1", 1],
  ["L2", 2],
  ["R1", 4],
  ["R2", 8],
  ["Up", 16],
  ["Down", 32],
  ["Left", 64],
  ["Right", 128],
  ["X", 256],
  ["B", 512],
  ["Y", 1024],
  ["A", 2048],
] as const

const axes = ["axis1", "axis2", "axis3", "axis4"] as const

const ranges: Record<string, [number, number]> = {
  axis1: [-127, 127],
  axis2: [-127, 127],
  axis3: [-127, 127],
  axis4: [-127, 127],
  capacity: [0, 100],
}

export function ControllerNode({ id, data }: NodeProps<Node<ControllerData>>) {
  const masterInUse = useApp((state) =>
    state.nodes.some(
      (node) =>
        node.id !== id &&
        node.type === "controller" &&
        node.data.controllerId === 0,
    ),
  )
  const partnerInUse = useApp((state) =>
    state.nodes.some(
      (node) =>
        node.id !== id &&
        node.type === "controller" &&
        node.data.controllerId === 1,
    ),
  )

  function setValue(key: keyof ControllerData, value: number | boolean) {
    updateNodeData(id, { [key]: value })
  }

  function toggleButton(mask: number) {
    const buttons = data.buttons ?? 0
    setValue("buttons", buttons & mask ? buttons & ~mask : buttons | mask)
  }

  function inputValue(input: HTMLInputElement, key: keyof ControllerData) {
    const value = input.valueAsNumber
    if (!Number.isFinite(value)) return
    const [min, max] = ranges[key] ?? [
      Number.MIN_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    ]
    setValue(key, Math.max(min, Math.min(max, Math.round(value))))
  }

  return (
    <NodeBase
      className="controller-node w-68"
      title="V5 Controller"
      handle={
        <ConnectorHandle
          id="connector"
          type="source"
          position={Position.Left}
        />
      }
      icon={<Controller size="16" />}
    >
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
        <Button
          type="button"
          size="sm"
          className="flex-1"
          variant={(data.controllerId ?? 0) === 0 ? "secondary" : "ghost"}
          aria-pressed={(data.controllerId ?? 0) === 0}
          disabled={masterInUse}
          onClick={() => setValue("controllerId", 0)}
        >
          Master
        </Button>
        <Button
          type="button"
          size="sm"
          className="flex-1"
          variant={data.controllerId === 1 ? "secondary" : "ghost"}
          aria-pressed={data.controllerId === 1}
          disabled={partnerInUse}
          onClick={() => setValue("controllerId", 1)}
        >
          Partner
        </Button>
      </div>

      <div className="flex items-center justify-between border-b border-border/70 pb-2">
        <span className="text-xs text-muted-foreground">Wireless link</span>
        <Button
          type="button"
          size="sm"
          variant={data.connected ? "secondary" : "outline"}
          aria-pressed={data.connected === true}
          onClick={() => setValue("connected", data.connected !== true)}
        >
          <span
            className={cx(
              "size-2 rounded-full",
              data.connected ? "bg-primary" : "bg-muted-foreground",
            )}
          ></span>
          {data.connected ? "Connected" : "Disconnected"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {axes.map((axis, index) => (
          <Field key={axis} label={"Axis " + (index + 1)} layout="vertical">
            <Input
              type="number"
              className="nodrag h-8 w-full text-right font-mono tabular-nums"
              min={-127}
              max={127}
              step={1}
              value={data[axis] ?? 0}
              onChange={(event) => inputValue(event.currentTarget, axis)}
            />
          </Field>
        ))}
      </div>

      <div
        className="grid grid-cols-4 gap-1"
        role="group"
        aria-label="Controller buttons"
      >
        {buttonInputs.map(([label, mask]) => (
          <Button
            key={label}
            type="button"
            size="sm"
            className="min-w-0 px-1 font-mono"
            variant={(data.buttons ?? 0) & mask ? "secondary" : "outline"}
            aria-label={"Controller button " + label}
            aria-pressed={((data.buttons ?? 0) & mask) !== 0}
            onClick={() => toggleButton(mask)}
          >
            {label}
          </Button>
        ))}
      </div>

      <Field label="Battery">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            className="nodrag h-8 w-16 text-right font-mono tabular-nums"
            min={0}
            max={100}
            step={1}
            aria-label="Controller battery percentage"
            value={data.capacity ?? 100}
            onChange={(event) => inputValue(event.currentTarget, "capacity")}
          />
          <span className="text-xs text-muted-foreground">%</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${data.capacity ?? 100}%` }}
            ></div>
          </div>
        </div>
      </Field>
    </NodeBase>
  )
}
