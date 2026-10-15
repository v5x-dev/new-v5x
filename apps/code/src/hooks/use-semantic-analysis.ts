import * as React from 'react'
import type { FoldingRange } from 'vscode-languageserver-protocol'
import type { ClangdClient } from '~/lib/ide/clangd-client'
import {
  languagePattern,
  requestFoldingRanges,
  requestSemanticColors,
} from '~/lib/ide/language-features'
import type { SemanticColor } from '~/lib/ide/semantic-tokens'
import type { Documents, WorkspaceDocument } from '~/lib/ide/workspace'

const FIRST_REQUEST_DELAY = 180
const RETRY_DELAY = 2_000
const MAX_ATTEMPTS = 3

export interface SemanticAnalysis {
  path: string
  version: number
  tokens: Array<SemanticColor>
  folds: Array<FoldingRange>
}

// Requests semantic colors and folding ranges for the selected document.
// Pierre remaps existing colors through edits while fresh analysis is pending.
export function useSemanticAnalysis({
  clientRef,
  ready,
  selected,
  paused,
  documentsRef,
}: {
  clientRef: { current: ClangdClient | null }
  ready: boolean
  selected: WorkspaceDocument | undefined
  // Analysis pauses while a read-only SDK header is shown.
  paused: boolean
  documentsRef: { current: Documents }
}) {
  const [analysis, setAnalysis] = React.useState<SemanticAnalysis | null>(null)

  React.useEffect(() => {
    if (!ready) setAnalysis(null)
  }, [ready])

  React.useEffect(() => {
    const client = clientRef.current

    if (
      !ready ||
      !client?.ready ||
      !selected ||
      selected.deleted ||
      paused ||
      !languagePattern.test(selected.path)
    )
      return

    const controller = new AbortController()
    const { path, version } = selected

    let timer: ReturnType<typeof setTimeout>
    let attempts = 0
    let colors: Array<SemanticColor> | undefined
    let ranges: Array<FoldingRange> | undefined

    const refresh = () => {
      attempts++

      const tokens =
        colors !== undefined
          ? Promise.resolve(colors)
          : requestSemanticColors(client, path, controller.signal)

      const folds =
        ranges !== undefined
          ? Promise.resolve(ranges)
          : requestFoldingRanges(client, path, controller.signal)

      void Promise.allSettled([tokens, folds]).then(
        ([tokenResult, foldResult]) => {
          if (
            controller.signal.aborted ||
            documentsRef.current[path]?.version !== version
          )
            return

          if (tokenResult.status === 'fulfilled') colors = tokenResult.value
          if (foldResult.status === 'fulfilled') ranges = foldResult.value

          // Background analysis is optional. Keep Pierre's existing colors and
          // folds when clangd is busy, and retain either successful response.
          if (colors !== undefined || ranges !== undefined)
            setAnalysis((current) => ({
              path,
              version,
              tokens: colors ?? (current?.path === path ? current.tokens : []),
              folds: ranges ?? (current?.path === path ? current.folds : []),
            }))

          if (
            (colors === undefined || ranges === undefined) &&
            attempts < MAX_ATTEMPTS
          )
            timer = setTimeout(refresh, attempts * RETRY_DELAY)
        },
      )
    }

    timer = setTimeout(refresh, FIRST_REQUEST_DELAY)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [ready, selected?.path, selected?.version, paused])

  return analysis
}
