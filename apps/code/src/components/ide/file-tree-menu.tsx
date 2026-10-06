import * as React from 'react'
import {
  ArrowRightIcon,
  ClipboardIcon,
  CopyIcon,
  DownloadSimpleIcon,
  FileIcon,
  FilePlusIcon,
  FilesIcon,
  FolderIcon,
  FolderPlusIcon,
  LinkIcon,
  PencilSimpleIcon,
  ScissorsIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import type {
  ContextMenuItem as PierreContextMenuItem,
  ContextMenuOpenContext as PierreContextMenuOpenContext,
} from '@pierre/trees'
import type { FileOperation, FileOperations } from '~/lib/ide/file-operations'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '~/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Button } from '~/components/ui/button'

export interface TreeClipboard {
  path: string
  cut: boolean
  files: Record<string, string>
}

export interface TreeAction {
  kind: 'create' | 'folder' | 'rename' | 'move' | 'duplicate' | 'delete'
  path: string
  directory: boolean
}

const parentPath = (path: string) => path.split('/').slice(0, -1).join('/')

const join = (parent: string, name: string) =>
  parent ? `${parent}/${name}` : name

export function pasteFiles(
  ops: FileOperations,
  clipboard: TreeClipboard,
  destination: string,
) {
  const to = join(destination, clipboard.path.split('/').at(-1)!)

  ops.apply(
    clipboard.cut
      ? { kind: 'move', path: clipboard.path, to }
      : { kind: 'copy', path: clipboard.path, to, files: clipboard.files },
  )
}

export function FileTreeMenu({
  item,
  context,
  operationsRef,
  disabled,
  readOnly,
  clipboard,
  setClipboard,
  onAction,
  onError,
}: {
  item: PierreContextMenuItem
  context: PierreContextMenuOpenContext
  operationsRef?: { current: FileOperations | null }
  disabled: boolean
  readOnly: boolean
  clipboard: TreeClipboard | null
  setClipboard: (value: TreeClipboard | null) => void
  onAction: (action: TreeAction) => void
  onError: (message: string) => void
}) {
  const path = item.path.replace(/\/$/, '')
  const directory = item.kind === 'directory'
  const unavailable = disabled || readOnly || !operationsRef?.current

  const execute = (work: (ops: FileOperations) => void) => {
    try {
      if (!operationsRef?.current)
        throw new Error('Wait for the workspace to load.')

      work(operationsRef.current)
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const action = (kind: TreeAction['kind']) => {
    context.close({ restoreFocus: false })
    onAction({ kind, path, directory })
  }

  return (
    <ContextMenu
      open
      onOpenChange={(open) => {
        if (!open) context.close()
      }}
    >
      <ContextMenuContent
        data-file-tree-context-menu-root="true"
        anchor={{
          getBoundingClientRect: () => DOMRect.fromRect(context.anchorRect),
        }}
        side="bottom"
        align="start"
        alignOffset={0}
        sideOffset={2}
        className="w-56"
      >
        <ContextMenuGroup>
          <ContextMenuLabel className="truncate">{item.name}</ContextMenuLabel>
          <ContextMenuItem
            onClick={() => {
              context.anchorElement.click()
              context.close()
            }}
          >
            {directory ? <FolderIcon /> : <FileIcon />}
            {directory ? 'Expand / collapse' : 'Open'}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={unavailable}
            onClick={() => action('create')}
          >
            <FilePlusIcon />
            New file...
          </ContextMenuItem>
          <ContextMenuItem
            disabled={unavailable}
            onClick={() => action('folder')}
          >
            <FolderPlusIcon />
            New folder...
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={unavailable}
          onClick={() =>
            execute((ops) =>
              setClipboard({ path, cut: true, files: ops.read(path) }),
            )
          }
        >
          <ScissorsIcon />
          Cut
        </ContextMenuItem>
        <ContextMenuItem
          disabled={unavailable}
          onClick={() =>
            execute((ops) =>
              setClipboard({ path, cut: false, files: ops.read(path) }),
            )
          }
        >
          <CopyIcon />
          Copy
        </ContextMenuItem>
        <ContextMenuItem
          disabled={unavailable || !clipboard}
          onClick={() =>
            execute((ops) => {
              if (!clipboard) return
              pasteFiles(ops, clipboard, directory ? path : parentPath(path))
              if (clipboard.cut) setClipboard(null)
            })
          }
        >
          <ClipboardIcon />
          Paste
        </ContextMenuItem>
        <ContextMenuItem
          disabled={unavailable}
          onClick={() => action('duplicate')}
        >
          <FilesIcon />
          Duplicate...
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => {
            void navigator.clipboard
              .writeText(path)
              .catch(() => onError('Could not copy the path to the clipboard.'))
          }}
        >
          <LinkIcon />
          Copy relative path
        </ContextMenuItem>
        {!directory && (
          <ContextMenuItem
            disabled={unavailable}
            onClick={() =>
              execute((ops) => {
                const files = ops.read(path)
                if (!(path in files)) throw new Error('File no longer exists.')

                const url = URL.createObjectURL(
                  new Blob([files[path]], { type: 'application/octet-stream' }),
                )

                const link = document.createElement('a')
                link.href = url
                link.download = item.name
                link.click()
                setTimeout(() => URL.revokeObjectURL(url), 1000)
              })
            }
          >
            <DownloadSimpleIcon />
            Download
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={unavailable}
          onClick={() => action('rename')}
        >
          <PencilSimpleIcon />
          Rename...
        </ContextMenuItem>
        <ContextMenuItem disabled={unavailable} onClick={() => action('move')}>
          <ArrowRightIcon />
          Move to...
        </ContextMenuItem>
        <ContextMenuItem
          disabled={unavailable}
          variant="destructive"
          onClick={() => action('delete')}
        >
          <TrashIcon />
          Delete...
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

const titles = {
  create: 'New file',
  folder: 'New folder',
  rename: 'Rename',
  move: 'Move to',
  duplicate: 'Duplicate',
  delete: 'Delete',
}

export function FileActionDialog({
  action,
  operationsRef,
  onClose,
}: {
  action: TreeAction
  operationsRef?: { current: FileOperations | null }
  onClose: () => void
}) {
  const name = action.path.split('/').at(-1) ?? ''

  const [value, setValue] = React.useState(
    action.kind === 'rename'
      ? name
      : action.kind === 'move'
        ? action.path
        : action.kind === 'duplicate'
          ? join(
              parentPath(action.path),
              name.replace(/(\.[^.]+)?$/, ' copy$1'),
            )
          : '',
  )

  const [error, setError] = React.useState('')

  const submit = (event: React.FormEvent) => {
    event.preventDefault()

    try {
      const ops = operationsRef?.current
      if (!ops) throw new Error('Workspace is unavailable.')
      let operation: FileOperation

      if (action.kind === 'delete')
        operation = { kind: 'delete', path: action.path }
      else {
        const input = value.trim()
        if (!input) throw new Error('Enter a name or path.')

        if (action.kind === 'rename' && input.includes('/'))
          throw new Error(
            'Enter a name without slashes. Use Move to to change folders.',
          )

        const parent = action.directory ? action.path : parentPath(action.path)

        const to =
          action.kind === 'rename'
            ? join(parentPath(action.path), input)
            : input

        operation =
          action.kind === 'create' || action.kind === 'folder'
            ? {
                kind: 'create',
                path: join(parent, input),
                folder: action.kind === 'folder',
              }
            : action.kind === 'duplicate'
              ? {
                  kind: 'copy',
                  path: action.path,
                  to,
                  files: ops.read(action.path),
                }
              : { kind: 'move', path: action.path, to }
      }

      ops.apply(operation)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {titles[action.kind]}
              {action.kind === 'delete' ? ` ${name}?` : ''}
            </DialogTitle>
            <DialogDescription>
              {action.kind === 'delete'
                ? `This removes ${action.path}${action.directory ? ' and all files inside it' : ''} from your draft. Commit changes to save the deletion.`
                : action.kind === 'folder'
                  ? 'Empty folders contain a .gitkeep file so they can be committed.'
                  : action.kind === 'move' || action.kind === 'duplicate'
                    ? 'Enter the destination path relative to the project root.'
                    : action.kind === 'rename'
                      ? action.path
                      : `Create in ${action.directory ? action.path || 'project root' : parentPath(action.path) || 'project root'}.`}
            </DialogDescription>
          </DialogHeader>
          {action.kind !== 'delete' && (
            <div className="grid gap-2">
              <label htmlFor="file-operation-name" className="text-sm">
                {action.kind === 'move' || action.kind === 'duplicate'
                  ? 'Destination path'
                  : 'Name'}
              </label>
              <Input
                id="file-operation-name"
                autoFocus
                value={value}
                onFocus={(event) => event.target.select()}
                onChange={(event) => setValue(event.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? 'file-operation-error' : undefined}
                placeholder={
                  action.kind === 'folder' ? 'new-folder' : 'example.cpp'
                }
              />
            </div>
          )}
          {error && (
            <p
              id="file-operation-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={action.kind === 'delete' ? 'destructive' : 'default'}
            >
              {titles[action.kind]}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
