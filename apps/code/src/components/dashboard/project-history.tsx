import { PatchDiff } from '@pierre/diffs/react'
import { useAction } from 'convex/react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '@v5x/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@v5x/ui/components/dialog'

type Commit = { sha: string; message: string; author: string; date: string }
const options = {
  diffStyle: 'unified' as const,
  theme: 'pierre-dark',
  themeType: 'dark' as const,
}

export function ProjectHistory({
  programId,
  onClose,
}: {
  programId: Id<'program'>
  onClose: () => void
}) {
  const list = useAction(api.programHistory.list)
  const diff = useAction(api.programHistory.diff)
  const restore = useAction(api.programHistory.restore)
  const [commits, setCommits] = useState<Commit[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [head, setHead] = useState('')
  const [selected, setSelected] = useState<Commit | null>(null)
  const [files, setFiles] = useState<Array<{ path: string; patch: string }>>([])
  const [omitted, setOmitted] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const request = useRef(0)

  useEffect(() => {
    let active = true
    void list({ programId })
      .then((result) => {
        if (!active) return
        setCommits(result.commits)
        setCursor(result.cursor)
        setHead(result.head)
        if (result.commits[0]) void select(result.commits[0])
      })
      .catch((reason) => {
        if (active) setError(String(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      request.current++
    }
  }, [programId, list])

  async function select(commit: Commit) {
    const revision = ++request.current
    setSelected(commit)
    setConfirm(false)
    setFiles([])
    setOmitted([])
    setBusy(true)
    setError('')
    try {
      const result = await diff({ programId, commitSha: commit.sha })
      if (request.current === revision) {
        setFiles(result.files)
        setOmitted(result.omitted)
      }
    } catch (reason) {
      if (request.current === revision) setError(String(reason))
    } finally {
      if (request.current === revision) setBusy(false)
    }
  }

  async function more() {
    if (!cursor || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await list({ programId, cursor })
      if (result.head !== head)
        throw new Error('The project changed. Close and reopen history.')
      setCommits((old) => [...old, ...result.commits])
      setCursor(result.cursor)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function restoreSelected() {
    if (!selected || busy) return
    setBusy(true)
    setError('')
    try {
      await restore({
        programId,
        commitSha: selected.sha,
        expectedCommitSha: head,
      })
      onClose()
    } catch (reason) {
      setError(String(reason))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !busy) onClose()
      }}
    >
      <DialogContent className="project-history-dialog flex h-[calc(100dvh-1rem)] max-h-[900px] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 font-sans sm:h-[85dvh] sm:w-full sm:max-w-6xl">
        <DialogHeader className="project-history-header shrink-0 border-b px-6 py-5 pr-12">
          <DialogTitle className="text-lg">Project history</DialogTitle>
          <DialogDescription className="project-history-description">
            Browse commits and review changes to your project.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p
            role="alert"
            className="shrink-0 border-b px-6 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <div className="project-history-layout grid min-h-0 flex-1 grid-rows-[minmax(0,6rem)_minmax(0,1fr)] md:grid-cols-[17rem_minmax(0,1fr)] md:grid-rows-1">
          <aside
            aria-label="Commits"
            className="overflow-y-auto border-b bg-muted/20 p-2 md:border-r md:border-b-0 md:p-3"
          >
            <p className="project-history-commit-count px-3 pb-3 pt-1 text-xs font-medium text-muted-foreground">
              {loading
                ? 'Loading commits...'
                : `${commits.length} ${commits.length === 1 ? 'commit' : 'commits'}`}
            </p>
            <div className="project-history-commits flex flex-col gap-1">
              {commits.map((commit) => (
                <Button
                  key={commit.sha}
                  variant={selected?.sha === commit.sha ? 'secondary' : 'ghost'}
                  aria-pressed={selected?.sha === commit.sha}
                  className="project-history-commit h-auto w-full justify-start whitespace-normal rounded-lg px-3 py-3 text-left"
                  disabled={busy}
                  onClick={() => void select(commit)}
                >
                  <span className="project-history-commit-content flex min-w-0 flex-col gap-2">
                    <span className="project-history-commit-message block break-words text-sm leading-snug font-medium">
                      {commit.message}
                    </span>
                    <span className="project-history-commit-meta flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-mono">
                        {commit.sha.slice(0, 8)}
                      </span>
                      {commit.sha === head && (
                        <span className="text-primary">Latest</span>
                      )}
                      <span>{new Date(commit.date).toLocaleDateString()}</span>
                    </span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {commit.author}
                    </span>
                  </span>
                </Button>
              ))}
              {!loading && commits.length === 0 && (
                <p className="px-3 text-sm text-muted-foreground">
                  No commits yet.
                </p>
              )}
              {cursor && (
                <Button
                  disabled={busy}
                  variant="ghost"
                  onClick={() => void more()}
                >
                  Load older commits
                </Button>
              )}
            </div>
          </aside>
          <section
            aria-label="Commit changes"
            className="flex min-h-0 min-w-0 flex-col"
          >
            {selected ? (
              <>
                <div className="project-history-selected-header shrink-0 border-b px-5 py-4">
                  <h3 className="break-words text-sm font-medium">
                    {selected.message}
                  </h3>
                  <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono">
                      {selected.sha.slice(0, 8)}
                    </span>
                    <span>{selected.author}</span>
                    <span>{new Date(selected.date).toLocaleString()}</span>
                  </p>
                </div>
                <div className="project-history-diffs min-h-0 flex-1 overflow-auto bg-background/40 p-4 md:p-5">
                  {busy ? (
                    <p role="status" className="text-sm text-muted-foreground">
                      Loading changes...
                    </p>
                  ) : (
                    <>
                      <p className="mb-4 text-xs text-muted-foreground">
                        {files.length} changed{' '}
                        {files.length === 1 ? 'file' : 'files'}
                      </p>
                      <div className="flex flex-col gap-4">
                        {files.map((file) => (
                          <div
                            key={file.path}
                            className="overflow-hidden rounded-lg border"
                          >
                            <PatchDiff patch={file.patch} options={options} />
                          </div>
                        ))}
                      </div>
                      {omitted.length > 0 && (
                        <p className="mt-4 break-words text-sm text-muted-foreground">
                          Diff unavailable for: {omitted.join(', ')}
                        </p>
                      )}
                    </>
                  )}
                </div>
                <div className="project-history-selected-footer shrink-0 border-t px-5 py-4">
                  {selected.sha === head ? (
                    <p className="text-xs text-muted-foreground">
                      This is the latest committed version.
                    </p>
                  ) : confirm ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="flex-1 text-sm">
                        Restore the project to{' '}
                        <span className="font-mono">
                          {selected.sha.slice(0, 8)}
                        </span>
                        ?
                      </p>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setConfirm(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => void restoreSelected()}
                      >
                        Restore as a new commit
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        Restoring keeps earlier history and local drafts.
                      </p>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => setConfirm(true)}
                      >
                        Restore this version
                      </Button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <p className="text-sm font-medium">Review a version</p>
                <p className="text-sm text-muted-foreground">
                  Select a commit to see its changes.
                </p>
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
