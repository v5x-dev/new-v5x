export function NumberDisplay({
  value,
  decimals = 2,
}: {
  value: number
  decimals?: number
}) {
  return (
    <div className="number-display w-16 overflow-x-hidden rounded border border-secondary px-[4px_0] py-0.5">
      {value.toFixed(decimals)}
    </div>
  )
}
