import * as React from 'react'
import { DraftWriter, type DraftStatus } from '~/lib/ide/draft-writer'
import { writeWorkspace } from '~/lib/ide/persistence'

const unreadableDraftMessage =
  'The existing local draft could not be read. Download your current work before reloading to retry.'

// Saves debounced workspace snapshots to IndexedDB and flushes them when the
// page is hidden.
export function useDraftWriter(workspaceId: string) {
  const [status, setStatus] = React.useState<DraftStatus>('saved')
  const [error, setError] = React.useState<string | undefined>()
  const writerRef = React.useRef<DraftWriter | null>(null)
  // Workspaces whose existing local draft could not be read. Writing would
  // overwrite the unreadable draft, so it is refused.
  const blockedRef = React.useRef(new Set<string>())

  React.useEffect(() => {
    let active = true

    const writer = new DraftWriter(
      async (snapshot) => {
        if (blockedRef.current.has(workspaceId))
          throw new Error(
            'The existing local draft could not be read. Download a recovery copy of your current work before reloading to retry.',
          )
        await writeWorkspace(workspaceId, snapshot)
      },
      (nextStatus, nextError) => {
        if (active) {
          setStatus(nextStatus)
          setError(nextError)
        }
      },
    )

    writerRef.current = writer
    const flush = () => void writer.flush()
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush()
    }

    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', hidden)

    return () => {
      active = false
      flush()
      writerRef.current = null
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [workspaceId])

  const markUnreadable = React.useCallback(() => {
    blockedRef.current.add(workspaceId)
    setStatus('error')
    setError(unreadableDraftMessage)
  }, [workspaceId])

  return { writerRef, status, error, markUnreadable }
}
