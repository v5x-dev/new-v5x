import * as React from 'react'
import { FileTree, useFileTree } from '@pierre/trees/react'

export function ProgramFileTree({
  paths,
  selectedFile,
  onSelect,
}: {
  paths: Array<string>
  selectedFile: string
  onSelect: (path: string) => boolean
}) {
  const modelRef = React.useRef<ReturnType<typeof useFileTree>['model'] | null>(
    null,
  )
  const onSelectRef = React.useRef(onSelect)
  const selectedFileRef = React.useRef(selectedFile)
  const revertingSelectionRef = React.useRef(false)
  onSelectRef.current = onSelect
  selectedFileRef.current = selectedFile
  const model = useFileTree({
    paths,
    initialExpansion: 'open',
    initialSelectedPaths: [selectedFile],
    unsafeCSS: `
      [data-type='item'][data-item-path^='build/'] {
        color: var(--trees-fg-muted);
      }
    `,
    onSelectionChange: (selectedPaths) => {
      if (revertingSelectionRef.current) return
      const path = [...selectedPaths]
        .reverse()
        .find((selected) => paths.includes(selected))
      if (path && !onSelectRef.current(path)) {
        revertingSelectionRef.current = true
        try {
          for (const selectedPath of selectedPaths) {
            modelRef.current?.getItem(selectedPath)?.deselect()
          }
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
      for (const path of paths)
        if (path !== selectedFile) model.getItem(path)?.deselect()
      model.getItem(selectedFile)?.select()
    } finally {
      revertingSelectionRef.current = false
    }
  }, [model, paths, selectedFile])

  return (
    <FileTree
      model={model}
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
  )
}
