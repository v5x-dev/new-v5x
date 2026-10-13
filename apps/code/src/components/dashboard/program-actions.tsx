import { DotsThreeIcon } from '@phosphor-icons/react'
import { useAction, useMutation } from 'convex/react'
import { useState } from 'react'
import { ConvexError } from 'convex/values'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '~/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '~/components/ui/dropdown-menu'
import { exportSourceZip } from '~/lib/source-zip'
import { ProjectHistory } from './project-history'
import { Input } from '~/components/ui/input'

export function ProgramActions({
  program,
  onError,
}: {
  program: Doc<'program'>
  onError: (message: string | null) => void
}) {
  const snapshot = useAction(api.program.getWorkspaceSnapshot)
  const duplicate = useAction(api.program.duplicate)
  const deleteProgram = useAction(api.program.deleteProgram)
  const rename = useMutation(api.program.rename)
  const setArchived = useMutation(api.program.setArchived)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(program.name)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function saveName(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setRenameError(null)
    try {
      await rename({ programId: program._id, name })
      setOpen(false)
    } catch (reason) {
      setRenameError(
        reason instanceof Error ? reason.message : 'Unable to rename program.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function archive() {
    if (busy) return
    setBusy(true)
    onError(null)
    try {
      await setArchived({ programId: program._id, archived: !program.archived })
    } catch {
      onError('Unable to update archive status. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (busy) return
    setBusy(true)
    onError(null)
    try {
      await duplicate({ programId: program._id })
    } catch (reason) {
      onError(
        reason instanceof ConvexError && typeof reason.data === 'string'
          ? reason.data
          : 'Unable to duplicate program. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (busy || confirmation.trim() !== program.name) return
    setBusy(true)
    setDeleteError(null)
    try {
      const { deleteLocalProjectData } =
        await import('~/lib/ide/project-cleanup')
      await deleteLocalProjectData(program._id)
      await deleteProgram({ programId: program._id })
      setDeleteOpen(false)
    } catch (reason) {
      setDeleteError(
        reason instanceof Error
          ? `Deletion stopped before cleanup finished: ${reason.message}`
          : 'Deletion stopped before cleanup finished. Retry to continue.',
      )
    } finally {
      setBusy(false)
    }
  }

  function openDeleteDialog() {
    setConfirmation('')
    setDeleteError(null)
    setDeleteOpen(true)
  }

  async function exportSources() {
    if (busy) return
    setBusy(true)
    onError(null)
    try {
      const source = await snapshot({ programId: program._id })
      const bytes = exportSourceZip(
        Object.entries(source.files).map(([path, contents]) => ({
          path,
          contents,
        })),
      )
      const url = URL.createObjectURL(
        new Blob([bytes], { type: 'application/zip' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = `${program.name.replace(/[^a-z0-9_-]/gi, '_') || 'project'}-sources.zip`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (reason) {
      onError(
        reason instanceof Error
          ? reason.message
          : 'Unable to export project sources.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={`Actions for ${program.name}`}
            />
          }
        >
          <DotsThreeIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {program.deleting ? (
            <DropdownMenuItem onClick={openDeleteDialog}>
              Retry project deletion
            </DropdownMenuItem>
          ) : (
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  setName(program.name)
                  setRenameError(null)
                  setOpen(true)
                }}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                History
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportSources()}>
                Export committed sources (ZIP)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void copy()}>
                Duplicate committed project
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void archive()}>
                {program.archived ? 'Restore from archive' : 'Archive'}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={openDeleteDialog}
              >
                Delete project
              </DropdownMenuItem>
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {historyOpen && (
        <ProjectHistory
          programId={program._id}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename program</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => void saveName(event)}
            className="flex flex-col gap-4"
          >
            <fieldset className="flex flex-col gap-2" disabled={busy}>
              <label htmlFor={`program-name-${program._id}`}>Name</label>
              <Input
                id={`program-name-${program._id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                required
                disabled={busy}
                aria-invalid={!!renameError}
              />
              {renameError && (
                <p role="alert" className="text-destructive text-sm">
                  {renameError}
                </p>
              )}
            </fieldset>
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? 'Saving...' : 'Save name'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(value) => {
          if (!busy) setDeleteOpen(value)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {program.deleting ? 'Finish deleting project' : 'Delete project'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the committed project, build artifacts,
              and this browser's saved draft. Type{' '}
              <strong>{program.name}</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <label
            htmlFor={`delete-project-${program._id}`}
            className="text-sm font-medium"
          >
            Project name
          </label>
          <Input
            id={`delete-project-${program._id}`}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            disabled={busy}
          />
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void remove()}
              disabled={busy || confirmation.trim() !== program.name}
            >
              {busy ? 'Deleting...' : 'Delete project'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
