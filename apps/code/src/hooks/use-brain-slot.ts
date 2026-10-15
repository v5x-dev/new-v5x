import * as React from 'react'
import { readStorage, writeStorage } from '~/lib/browser-storage'
import { parseBrainSlot } from '~/lib/ide/brain-upload'

export function useBrainSlot(programId: string) {
  const key = `v5x:brain-slot:${programId}`
  const [slot, setSlotState] = React.useState(1)

  React.useEffect(() => {
    setSlotState(parseBrainSlot(readStorage(key)))
  }, [key])

  const setSlot = React.useCallback(
    (next: number) => {
      setSlotState(next)
      writeStorage(key, String(next))
    },
    [key],
  )

  return [slot, setSlot] as const
}
