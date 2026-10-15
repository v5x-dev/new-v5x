import * as React from 'react'
import { useAction } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { parseProgramFilePaths } from '~/lib/program-files'

// Lists a program's committed file paths. The workspace editor replaces them
// with its live paths once it has loaded.
export function useProgramFiles(programId: Id<'program'>) {
  const getProgramFiles = useAction(api.program.getProgramFiles)
  const [paths, setPaths] = React.useState<Array<string> | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    let active = true
    setPaths(null)
    setError(null)

    getProgramFiles({ programId })
      .then((result) => {
        if (active) setPaths(parseProgramFilePaths(result))
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Could not load program files.',
          )
      })

    return () => {
      active = false
    }
  }, [getProgramFiles, programId, attempt])

  const retry = React.useCallback(() => setAttempt((count) => count + 1), [])

  return { paths, setPaths, error, retry }
}
