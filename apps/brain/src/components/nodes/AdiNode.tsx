import { Position, type Node, type NodeProps } from "@xyflow/react"
import { AdiPortHandle, SmartPortHandle } from "~/components/handles"
import { cx } from "~/lib/utils"

type AdiData = { onboard?: boolean }

export function AdiNode({ data }: NodeProps<Node<AdiData>>) {
  return (
    <div
      className={cx(
        "adi-inner flex w-50 items-center justify-center p-4 [&.adi-inner.onboard]:h-50! [&.adi-inner.onboard]:w-auto! [&.adi-inner.onboard_.ports]:top-[50%]! [&.adi-inner.onboard_.ports]:left-0! [&.adi-inner.onboard_.ports]:h-full! [&.adi-inner.onboard_.ports]:w-auto! [&.adi-inner.onboard_.ports]:transform-[translateX(-50%)_translateY(-50%)]! [&.adi-inner.onboard_.ports]:flex-col!",
        data.onboard && "onboard",
      )}
    >
      ADI
      <SmartPortHandle
        id="connector"
        type="source"
        position={data.onboard ? Position.Right : Position.Bottom}
      />
      <div className="ports absolute top-0 left-[50%] flex w-full transform-[translateX(-50%)_translateY(-50%)] justify-evenly [&.ports_>_.react-flow\_\_handle]:relative! [&.ports_>_.react-flow\_\_handle]:top-0! [&.ports_>_.react-flow\_\_handle]:left-0! [&.ports_>_.react-flow\_\_handle]:transform-none!">
        {["a", "b", "c", "d", "e", "f", "g", "h"].map((port) => (
          <AdiPortHandle
            key={port}
            id={port}
            type="target"
            position={data.onboard ? Position.Left : Position.Top}
          />
        ))}
      </div>
    </div>
  )
}
