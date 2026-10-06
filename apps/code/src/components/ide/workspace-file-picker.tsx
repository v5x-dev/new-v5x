import type { Documents } from '~/lib/ide/workspace'
import { isDirty, workspaceDocuments } from '~/lib/ide/workspace'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'

interface Props {
  documents: Documents
  fileQuery: string | null
  setFileQuery: (query: string | null) => void
  onSelect: (path: string) => void
}

export function WorkspaceFilePicker({
  documents,
  fileQuery,
  setFileQuery,
  onSelect,
}: Props) {
  return (
    <CommandDialog
      title="Open file"
      description="Find and open a project file."
      open={fileQuery !== null}
      onOpenChange={(open) => setFileQuery(open ? '' : null)}
      className="sm:max-w-xl"
    >
      <Command>
        <CommandInput
          aria-label="Find file"
          placeholder="Find a file…"
          value={fileQuery ?? ''}
          onValueChange={setFileQuery}
        />
        <CommandList>
          <CommandEmpty>No matching files.</CommandEmpty>
          {workspaceDocuments(documents)
            .filter((doc) => !doc.deleted)
            .map((doc) => (
              <CommandItem
                key={doc.path}
                value={doc.path}
                onSelect={() => {
                  onSelect(doc.path)
                }}
              >
                <span className="truncate font-mono text-xs">{doc.path}</span>
                {isDirty(doc) && <span aria-label="Unsaved changes">•</span>}
              </CommandItem>
            ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
