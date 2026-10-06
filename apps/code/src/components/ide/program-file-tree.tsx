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
    initialExpansion: 'open',
    initialSelectedPaths: selectedFile ? [selectedFile] : [],
    composition: { contextMenu: { triggerMode: 'both' } },
    unsafeCSS: `
      [data-type='item'][data-item-path^='build/'] {
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

          selectedFileRef.current &&
            modelRef.current?.getItem(selectedFileRef.current)?.select()
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

      model.resetPaths(paths, { initialExpandedPaths })
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
                onAction={(next) => {
                  setError('')
                  setAction(next)
                }}
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
        <ContextMenuContent className="w-48">
          <ContextMenuItem
            disabled={disabled || !fileOperationsRef?.current}
            onClick={() =>
              setAction({ kind: 'create', path: '', directory: true })
            }
          >
            New file...
          </ContextMenuItem>
          <ContextMenuItem
            disabled={disabled || !fileOperationsRef?.current}
            onClick={() =>
              setAction({ kind: 'folder', path: '', directory: true })
            }
          >
            New folder...
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
