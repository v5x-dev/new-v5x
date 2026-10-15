import { Position, type Node, type NodeProps } from "@xyflow/react"
import { Fragment, useRef, useState } from "react"
import { Power, Upload } from "react-feather"
import { ConnectorHandle, SmartPortHandle } from "~/components/handles"
import { Button } from "~/components/ui/button"
import { Display } from "~/components/layout/Display"
import { desktop } from "~/lib/runtime"
import Session from "~/lib/session"
import { setSession, useApp, useSession } from "~/lib/stores"

const portsClass =
  "ports absolute left-18 z-1 flex w-107.5 justify-evenly [&.ports_>_.react-flow\\_\\_handle]:relative! [&.ports_>_.react-flow\\_\\_handle]:top-0! [&.ports_>_.react-flow\\_\\_handle]:left-0! [&.ports_>_.react-flow\\_\\_handle]:transform-none!"
const smartPortClass =
  "smart-port relative flex justify-center [&.smart-port_.smart-port-handle]:top-0! [&.smart-port_.smart-port-handle]:left-0! [&.smart-port_.smart-port-handle]:h-full! [&.smart-port_.smart-port-handle]:w-full! [&.smart-port_.smart-port-handle]:transform-none! [&.smart-port_.smart-port-handle]:opacity-0! [&.smart-port_svg]:block!"
const portLabelClass =
  "smart-port-label absolute h-5.5 w-5.5 rounded border-[1.5px] border-current text-center text-xs leading-5 text-muted-foreground"

const topIndicator = {
  className: "smart-port-indicator",
  height: 35,
  d: "M4.99994 1L32 1C34.2091 1 36 2.79086 36 5L36 24H31V29H26V34H11V29H5.99999L6 24H0.999939V5C0.999939 2.79086 2.7908 1 4.99994 1Z",
}
const bottomIndicator = {
  className: "",
  height: 35,
  d: "M32.0001 34H5.00002C2.79088 34 1.00002 32.2091 1.00002 30L1 11H6.00002V6H11V1H26V6H31L31 11H36.0001V30C36.0001 32.2091 34.2092 34 32.0001 34Z",
}

function PortRow({
  start,
  position,
  indicator,
  className,
}: {
  start: number
  position: Position
  indicator: typeof topIndicator
  className: string
}) {
  return (
    <div className={`${portsClass} ${className}`}>
      {Array.from({ length: 10 }, (_, n) => (
        <Fragment key={n}>
          <div className={smartPortClass}>
            <span className={portLabelClass}>{n + start}</span>
            <SmartPortHandle
              id={`${n + start}`}
              type="target"
              position={position}
            />
            <svg
              className={indicator.className || undefined}
              width="37"
              height={indicator.height}
              viewBox="0 0 37 35"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d={indicator.d}
                stroke="var(--secondary)"
                fill="var(--border)"
              />
            </svg>
          </div>
          {n === 4 && <div className="ports-spacer w-5"></div>}
        </Fragment>
      ))}
    </div>
  )
}

export function BrainNode(_props: NodeProps<Node>) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const { session, running } = useSession()
  const programName =
    session?.binary
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.bin$/, "") ?? ""

  async function load(binary: string, file?: File) {
    if (loading) return
    setLoading(true)
    setError("")
    try {
      await useApp.getState().session?.stop()
      const next = new Session(binary, file)
      setSession(next)
      await next.start()
    } catch (reason) {
      setError(String(reason))
      setSession(null)
    } finally {
      setLoading(false)
    }
  }

  async function loadExample() {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}example.bin`)
      if (!response.ok) throw new Error("Could not load example")
      const file = new File([await response.blob()], "example.bin")
      await load(file.name, file)
    } catch (reason) {
      setError(String(reason))
    }
  }

  async function handleButtonClick() {
    if (loading) return
    const current = useApp.getState().session
    if (current?.running) {
      await current.stop()
      setSession(null)
    } else fileInput.current?.click()
  }

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".bin,.v5x"
        aria-label="Upload program binary"
        className="hidden"
        onChange={(event) => {
          const input = event.currentTarget
          const file = input.files?.[0]
          if (file) void load(file.name, file)
          input.value = ""
        }}
      />
      {error && (
        <p role="alert" className="absolute top-15 z-5 bg-[#191919] p-3">
          {error}
        </p>
      )}
      <PortRow
        start={1}
        position={Position.Top}
        indicator={topIndicator}
        className="ports-top"
      />
      {!desktop && !running && (
        <Button
          variant="default"
          className="button absolute -bottom-9 left-20 z-3"
          disabled={loading}
          onClick={() => void loadExample()}
        >
          {loading ? "Starting…" : "Run example"}
        </Button>
      )}
      <div className="housing-inner absolute flex h-88.75 w-164.5 items-center justify-between rounded-3xl border border-secondary bg-muted px-[60px_18px] transition-all duration-150 ease-[ease] [&.housing-inner_.button]:h-16! [&.housing-inner_.button]:w-16! [&.housing-inner_.button]:rounded-[6px]! [&.housing-inner_.button]:p-0!">
        <Display programName={programName} />
        <Button
          variant="secondary"
          title={running ? "Unload program" : "Upload program"}
          className="button rounded-2xl! border! border-border! [&_svg]:size-8!"
          onClick={() => void handleButtonClick()}
        >
          {running ? <Power size="24" /> : <Upload size="24" />}
        </Button>
      </div>
      <div className="housing-inner-focus-outline"></div>
      <PortRow
        start={11}
        position={Position.Bottom}
        indicator={bottomIndicator}
        className="ports-bottom"
      />
      <div className="port-21 absolute top-25 right-0 flex items-center [&.port-21_.smart-port-label]:right-3!">
        <span className={portLabelClass}>21</span>
        <SmartPortHandle id="21" type="target" position={Position.Right} />
      </div>

      <ConnectorHandle
        id="battery_port"
        className="battery-port top-[66.66%]!"
        type="target"
        position={Position.Right}
      />
      <SmartPortHandle
        id="onboard_adi"
        type="target"
        position={Position.Left}
      />
    </>
  )
}
