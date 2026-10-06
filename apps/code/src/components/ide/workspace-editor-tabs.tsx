import { XIcon } from '@phosphor-icons/react'
import type { Documents } from '~/lib/ide/workspace'
import { isDirty } from '~/lib/ide/workspace'
import { Button } from '~/components/ui/button'
import { Tabs as EditorTabs, TabsList, TabsTrigger } from '~/components/ui/tabs'

interface Props {
  tabs: Array<string>
  documents: Documents
  selectedFile: string
  showingHeader: boolean
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onBack: () => void
}

export function WorkspaceEditorTabs({
  tabs,
  documents,
  selectedFile,
  showingHeader,
  onSelect,
  onClose,
  onBack,
}: Props) {
  return (
    <div className="flex h-9 shrink-0 items-stretch font-mono text-[11px]">
      <div className="min-w-0 flex-1 overflow-x-auto">
        <EditorTabs
          value={`file:${selectedFile}`}
          onValueChange={(value) => {
            if (typeof value === 'string' && value.startsWith('file:')) {
              onSelect(value.slice(5))
            }
          }}
        >
          <TabsList aria-label="Open files" variant="line">
            {tabs.map((path) => (
              <div key={path} className="flex shrink-0 items-center">
                <TabsTrigger value={`file:${path}`} title={path}>
                  {path.split('/').at(-1)}
                  {tabs.some(
                    (other) =>
                      other !== path &&
                      other.split('/').at(-1) === path.split('/').at(-1),
                  ) && (
                    <span className="ml-2 text-muted-foreground">
                      {path.slice(0, path.lastIndexOf('/'))}
                    </span>
                  )}
                  {documents[path] && isDirty(documents[path]) && (
                    <span aria-label="Unsaved changes" className="ml-2">
                      •
                    </span>
                  )}
                </TabsTrigger>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Close ${path}`}
                  title="Close file"

                  onClick={() => onClose(path)}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
          </TabsList>
        </EditorTabs>
      </div>
      {showingHeader ? (
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back to source
        </Button>
      ) : null}
    </div>
  )
}
