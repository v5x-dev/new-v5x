import { FileTree, useFileTree } from '@pierre/trees/react'

import React, { useCallback, useEffect, useRef } from 'react'

export const treeStyle: React.CSSProperties = {
  '--trees-fg-override': 'var(--foreground)',
  '--trees-fg-muted-override': 'var(--muted-foreground)',
  '--trees-bg-override': 'var(--sidebar)',
  '--trees-bg-muted-override': 'var(--muted)',
  '--trees-accent-override': 'var(--accent)',
  '--trees-border-color-override': 'var(--border)',

  '--trees-focus-ring-color-override': 'var(--ring)',
  '--trees-focus-ring-width-override': '1px',

  '--trees-search-fg-override': 'var(--popover-foreground)',
  '--trees-search-bg-override': 'var(--popover)',

  '--trees-selected-fg-override': 'var(--accent-foreground)',
  '--trees-selected-bg-override': 'var(--accent)',
  '--trees-selected-focused-border-color-override': 'var(--ring)',

  '--trees-status-added-override': 'var(--chart-2)',
  '--trees-status-ignored-override': 'var(--muted-foreground)',
  '--trees-status-modified-override': 'var(--chart-3)',
  '--trees-status-renamed-override': 'var(--chart-1)',
  '--trees-status-untracked-override': 'var(--muted-foreground)',
  '--trees-status-deleted-override': 'var(--destructive)',
  '--trees-git-added-color-override': 'var(--chart-2)',
  '--trees-git-ignored-color-override': 'var(--muted-foreground)',
  '--trees-git-modified-color-override': 'var(--chart-3)',
  '--trees-git-renamed-color-override': 'var(--chart-1)',
  '--trees-git-untracked-color-override': 'var(--muted-foreground)',
  '--trees-git-deleted-color-override': 'var(--destructive)',

  '--trees-font-family-override': 'var(--font-serif)',
  '--trees-padding-inline-override': 'var(--spacing)',
} as React.CSSProperties

export function ProgramTree({
  paths,
  onFileSelect,
  unsavedPaths,
}: {
  paths: readonly string[]
  onFileSelect: (path: string) => void
  unsavedPaths: ReadonlySet<string>
}) {
  const { model } = useFileTree({
    paths,
    search: false,
    initialExpansion: 'open',
    initialSelectedPaths: ['src/main.cpp'],
    onSelectionChange: (selectedPaths) => {
      if (selectedPaths[0] && paths.includes(selectedPaths[0])) {
        onFileSelect(selectedPaths[0])
      }
    },
  })

  return <FileTree model={model} style={treeStyle} />
}
