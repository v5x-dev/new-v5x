import * as React from 'react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { FileActionDialog, FileTreeMenu, pasteFiles } from './file-tree-menu'
import type { TreeAction, TreeClipboard } from './file-tree-menu'
import type { FileOperations } from '~/lib/ide/file-operations'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '~/components/ui/context-menu'

export function ProgramFileTree({
  paths,
  selectedFile,
  onSelect,
  fileOperationsRef,
  disabled = false,
  readOnlyPaths = [],
}: {
  paths: Array<string>
  selectedFile?: string
  onSelect: (path: string) => boolean
  fileOperationsRef?: { current: FileOperations | null }
  disabled?: boolean
  readOnlyPaths?: Array<string>
}) {
  const [clipboard, setClipboard] = React.useState<TreeClipboard | null>(null)
  const [action, setAction] = React.useState<TreeAction | null>(null)
  const [error, setError] = React.useState('')
  const pendingCreationRef = React.useRef<{
    path: string
    folder: boolean
  } | null>(null)
  const renameRef = React.useRef<(source: string, destination: string) => void>(
    () => {},
  )
  const accessRef = React.useRef({ disabled, readOnlyPaths, fileOperationsRef })
  accessRef.current = { disabled, readOnlyPaths, fileOperationsRef }

  const startAction = (next: TreeAction) => {
    setError('')
    if (next.kind === 'rename') {
      model.startRenaming(next.path)
      return
    }
    if (next.kind !== 'create' && next.kind !== 'folder') {
      setAction(next)
      return
    }

    const previous = pendingCreationRef.current
    if (previous) model.remove(previous.path, { recursive: true })
    const parent = next.directory
      ? next.path
      : next.path.split('/').slice(0, -1).join('/')
    const folder = next.kind === 'folder'
    const basename = folder ? 'New folder' : 'Untitled'
    let name = basename
    let index = 1
    while (model.getItem(parent ? `${parent}/${name}` : name))
      name = `${basename}-${index++}`
    const path = parent ? `${parent}/${name}` : name
    pendingCreationRef.current = { path, folder }
    model.add(path + (folder ? '/' : ''))
    if (!model.startRenaming(path, { removeIfCanceled: true })) {
      pendingCreationRef.current = null
      model.remove(path, { recursive: true })
    }
  }

  // Pierre skips onRename when the name is unchanged. Persist a new row
  // with its suggested name when the user accepts it with Enter or blur.
  const acceptSuggestedName = (event: React.SyntheticEvent) => {
    const pending = pendingCreationRef.current
    const input = event.nativeEvent
      .composedPath()
      .find(
        (target): target is HTMLInputElement =>
          target instanceof HTMLInputElement &&
          target.hasAttribute('data-item-rename-input'),
      )
    if (pending && input?.value.trim() === pending.path.split('/').at(-1))
      renameRef.current(pending.path, pending.path)
  }

  const modelRef = React.useRef<ReturnType<typeof useFileTree>['model'] | null>(
    null,
  )

  const pathsRef = React.useRef(paths)
  pathsRef.current = paths
  const onSelectRef = React.useRef(onSelect)
  const selectedFileRef = React.useRef(selectedFile)
  const revertingSelectionRef = React.useRef(false)
  onSelectRef.current = onSelect
  selectedFileRef.current = selectedFile

  const model = useFileTree({
    paths,
    flattenEmptyDirectories: false,
    initialExpansion: 'open',
    initialSelectedPaths: selectedFile ? [selectedFile] : [],
    composition: { contextMenu: { triggerMode: 'both' } },
    dragAndDrop: {
      canDrag: (draggedPaths) => {
        const access = accessRef.current
        return (
          !access.disabled &&
          !!access.fileOperationsRef?.current &&
          !pendingCreationRef.current &&
          draggedPaths.every((source) => {
            const path = source.replace(/\/$/, '')
            return !access.readOnlyPaths.some(
              (locked) =>
                locked === path ||
                locked.startsWith(`${path}/`) ||
                path.startsWith(`${locked}/`),
            )
          })
        )
      },
      canDrop: ({ target }) => {
        const access = accessRef.current
        const directory = target.directoryPath?.replace(/\/$/, '')
        return (
          !access.disabled &&
          !!access.fileOperationsRef?.current &&
          !access.readOnlyPaths.some(
            (locked) =>
              directory === locked || directory?.startsWith(`${locked}/`),
          )
        )
      },
      onDropComplete: ({ draggedPaths, target }) => {
        try {
          const ops = accessRef.current.fileOperationsRef?.current
          if (!ops) throw new Error('Workspace is unavailable.')
          const directory = target.directoryPath?.replace(/\/$/, '') ?? ''
          for (const source of draggedPaths) {
            const path = source.replace(/\/$/, '')
            const name = path.split('/').at(-1)!
            ops.apply({
              kind: 'move',
              path,
              to: directory ? `${directory}/${name}` : name,
            })
          }
          setError('')
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
          modelRef.current?.resetPaths(pathsRef.current)
        }
      },
      onDropError: setError,
    },
    renaming: {
      canRename: ({ path }) => {
        const access = accessRef.current
        return (
          !access.disabled &&
          !!access.fileOperationsRef?.current &&
          !access.readOnlyPaths.some(
            (locked) =>
              locked === path ||
              locked.startsWith(`${path}/`) ||
              path.startsWith(`${locked}/`),
          )
        )
      },
      onRename: ({ sourcePath, destinationPath }) =>
        renameRef.current(sourcePath, destinationPath),
      onError: setError,
    },
    unsafeCSS: `
      [data-type='item'][data-item-path^='build/'],
      [data-type='item'][data-item-path^='bin/'] {
        color: var(--trees-fg-muted);
      }
    `,
    onSelectionChange: (selectedPaths) => {
      if (revertingSelectionRef.current) return

      const path = [...selectedPaths]
        .reverse()
        .find((selected) => pathsRef.current.includes(selected))

      if (path && !onSelectRef.current(path)) {
        revertingSelectionRef.current = true

        try {
          for (const selectedPath of selectedPaths) {
            modelRef.current?.getItem(selectedPath)?.deselect()
          }

          if (selectedFileRef.current) {
            modelRef.current?.getItem(selectedFileRef.current)?.select()
          }
        } finally {
          revertingSelectionRef.current = false
        }
      }
    },
  }).model

  modelRef.current = model

  React.useEffect(() => {
    revertingSelectionRef.current = true

    try {
      const directories = new Set<string>()

      for (const path of paths) {
        const parts = path.split('/')

        for (let index = 1; index < parts.length; index++)
          directories.add(parts.slice(0, index).join('/') + '/')
      }

      const initialExpandedPaths = [...directories].filter((path) => {
        const item = model.getItem(path)
        return !item || ('isExpanded' in item && item.isExpanded())
      })

      const pending = pendingCreationRef.current
      model.resetPaths(
        pending
          ? [...paths, pending.path + (pending.folder ? '/' : '')]
          : paths,
        { initialExpandedPaths },
      )
    } finally {
      revertingSelectionRef.current = false
    }
  }, [model, paths])

  React.useEffect(() => {
    revertingSelectionRef.current = true

    try {
      for (const path of model.getSelectedPaths())
        if (path !== selectedFile) model.getItem(path)?.deselect()

      if (selectedFile) model.getItem(selectedFile)?.select()
    } finally {
      revertingSelectionRef.current = false
    }
  }, [model, paths, selectedFile])

  renameRef.current = (source, destination) => {
    const pending = pendingCreationRef.current
    try {
      const access = accessRef.current
      const ops = access.fileOperationsRef?.current
      if (access.disabled || !ops) throw new Error('Workspace is unavailable.')
      ops.apply(
        pending?.path === source
          ? { kind: 'create', path: destination, folder: pending.folder }
          : { kind: 'move', path: source, to: destination },
      )
      if (pending?.path === source) {
        pendingCreationRef.current = null
        if (!pending.folder) onSelectRef.current(destination)
      }
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      // Pierre moves its row after this callback. Restore the workspace paths
      // afterward if the workspace rejected the operation.
      pendingCreationRef.current = null
      queueMicrotask(() => model.resetPaths(pathsRef.current))
    }
  }

  React.useEffect(
    () =>
      model.onMutation('remove', (event) => {
        if (event.path.replace(/\/$/, '') === pendingCreationRef.current?.path)
          pendingCreationRef.current = null
      }),
    [model],
  )

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDownCapture={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing)
          acceptSuggestedName(event)
      }}
      onBlurCapture={acceptSuggestedName}
    >
      <ContextMenu>
        <ContextMenuTrigger
          className="min-h-0 flex-1"
          onContextMenu={(event) => {
            if (
              event.nativeEvent
                .composedPath()
                .some(
                  (target) =>
                    target instanceof HTMLElement &&
                    target.dataset.type === 'item',
                )
            )
              event.preventBaseUIHandler()
          }}
          onTouchStart={(event) => {
            if (
              event.nativeEvent
                .composedPath()
                .some(
                  (target) =>
                    target instanceof HTMLElement &&
                    target.dataset.type === 'item',
                )
            )
              event.preventBaseUIHandler()
          }}
        >
          <FileTree
            model={model}
            renderContextMenu={(item, context) => (
              <FileTreeMenu
                item={item}
                context={context}
                operationsRef={fileOperationsRef}
                disabled={disabled}
                readOnly={readOnlyPaths.some(
                  (path) =>
                    path === item.path ||
                    path.startsWith(item.path.replace(/\/$/, '') + '/'),
                )}
                clipboard={clipboard}
                setClipboard={setClipboard}
                onToggleDirectory={(path) => {
                  const directory = model.getItem(path)
                  if (directory && 'toggle' in directory) directory.toggle()
                }}
                onAction={startAction}
                onError={setError}
              />
            )}
            className="min-h-0 flex-1 rounded-lg py-1"
            style={
              {
                display: 'block',
                height: '100%',
                minHeight: 240,
                '--trees-font-family': 'var(--font-serif)',
                '--trees-padding-inline-override': 'var(--spacing)',
                '--trees-focus-ring-color-override': 'var(--ring)',
                '--trees-selected-focused-border-color-override': 'var(--ring)',
              } as React.CSSProperties
            }
          />
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48" finalFocus={false}>
          <ContextMenuItem
            disabled={disabled || !fileOperationsRef?.current}
            onClick={() =>
              startAction({ kind: 'create', path: '', directory: true })
            }
          >
            New file
          </ContextMenuItem>
          <ContextMenuItem
            disabled={disabled || !fileOperationsRef?.current}
            onClick={() =>
              startAction({ kind: 'folder', path: '', directory: true })
            }
          >
            New folder
          </ContextMenuItem>
          <ContextMenuItem
            disabled={disabled || !clipboard || !fileOperationsRef?.current}
            onClick={() => {
              if (!clipboard || !fileOperationsRef?.current) return

              try {
                pasteFiles(fileOperationsRef.current, clipboard, '')
                if (clipboard.cut) setClipboard(null)
              } catch (reason) {
                setError(
                  reason instanceof Error ? reason.message : String(reason),
                )
              }
            }}
          >
            Paste
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {error && (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {action && (
        <FileActionDialog
          key={JSON.stringify(action)}
          action={action}
          operationsRef={fileOperationsRef}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  )
}
