import * as React from 'react'
import { searchWorkspace, type Documents } from '~/lib/ide/workspace'

export type SearchResult = ReturnType<typeof searchWorkspace>[number]

// Workspace-wide text search. Results only recompute while the panel is open.
export function useWorkspaceSearch(
  documents: Documents,
  documentRevision: number,
) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [matchCase, setMatchCase] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const results = React.useMemo(
    () => (open ? searchWorkspace(documents, query, matchCase) : []),
    [documents, open ? documentRevision : 0, query, matchCase, open],
  )

  const groups = React.useMemo(() => {
    const byPath = new Map<string, Array<SearchResult>>()

    for (const result of results) {
      const group = byPath.get(result.path)
      if (group) group.push(result)
      else byPath.set(result.path, [result])
    }

    return byPath
  }, [results])

  const openSearch = React.useCallback(() => {
    setOpen(true)

    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  return {
    open,
    setOpen,
    openSearch,
    query,
    setQuery,
    matchCase,
    setMatchCase,
    inputRef,
    results,
    groups,
  }
}
