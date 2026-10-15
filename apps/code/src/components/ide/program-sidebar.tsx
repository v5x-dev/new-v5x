import * as React from 'react'
import { ArrowLeftIcon } from '@phosphor-icons/react'
import { AccountMenu } from '~/components/account-menu'
import { ProgramFileTree } from '~/components/ide/program-file-tree'
import { Button } from '~/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from '~/components/ui/sidebar'
import type { FileOperations } from '~/lib/ide/file-operations'

export function ProgramSidebar({
  programName,
  paths,
  readOnlyPaths,
  selectedFile,
  fileOperationsRef,
  treeDisabled,
  backDisabled,
  onBack,
  onSelect,
}: {
  programName: string | undefined
  paths: Array<string> | null
  readOnlyPaths: Array<string>
  selectedFile: string
  fileOperationsRef: { current: FileOperations | null }
  treeDisabled: boolean
  backDisabled: boolean
  onBack: () => void
  onSelect: (path: string) => boolean
}) {
  const [accountError, setAccountError] = React.useState<string | null>(null)

  return (
    <Sidebar
      variant="floating"
      innerClassName="relative group-data-[variant=floating]:rounded-br-none group-data-[variant=floating]:shadow-none [filter:drop-shadow(0_1px_2px_rgb(0_0_0/0.08))]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-full h-9 w-[calc(100svw-var(--sidebar-width))] rounded-r-lg bg-sidebar shadow-[0_-1px_0_var(--sidebar-border),1px_0_0_var(--sidebar-border),0_1px_0_var(--sidebar-border)]"
      />
      <div
        aria-hidden="true"
        className="workspace-sidebar-corner pointer-events-none absolute bottom-9 left-full size-(--radius-lg)"
      />
      <SidebarHeader className="flex-row items-center gap-1 px-2">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Back to programs"
          title="Back to programs"
          disabled={backDisabled}
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <span className="truncate text-sm font-medium">{programName}</span>
      </SidebarHeader>
      <SidebarContent className="min-h-0 p-0">
        {paths ? (
          <ProgramFileTree
            fileOperationsRef={fileOperationsRef}
            disabled={treeDisabled}
            readOnlyPaths={readOnlyPaths}
            paths={paths}
            selectedFile={selectedFile}
            onSelect={onSelect}
          />
        ) : null}
      </SidebarContent>
      <SidebarFooter className="p-2">
        {accountError && (
          <p role="alert" className="px-2 text-xs text-destructive">
            {accountError}
          </p>
        )}
        <AccountMenu
          side="top"
          align="start"
          showName
          onError={setAccountError}
        />
      </SidebarFooter>
    </Sidebar>
  )
}
