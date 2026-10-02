import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceEditor } from './components/ide/workspace-editor'
import { listWorkspaces } from './lib/ide/persistence'
import type { SavedWorkspace } from './lib/ide/persistence'
import './styles/app.css'

function OfflineWorkspace() {
  const [workspaces, setWorkspaces] = React.useState<
    Array<{ id: string; workspace: SavedWorkspace }>
  >([])
  const [id, setId] = React.useState('')
  const [path, setPath] = React.useState('')
  const [paths, setPaths] = React.useState<Array<string>>([])
  const [error, setError] = React.useState('')
  const saveHandlerRef = React.useRef<(() => Promise<void>) | null>(null)
  React.useEffect(() => {
    void listWorkspaces()
      .then((entries) =>
        setWorkspaces(
          entries.filter((entry) => !entry.id.startsWith('validation-')),
        ),
      )
      .catch((reason) => setError(String(reason)))
  }, [])
  const current = workspaces.find((entry) => entry.id === id)
  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <span>v5x · offline workspace</span>
        <a href="/" className="text-xs underline">
          Reconnect to projects
        </a>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-auto border-r bg-sidebar p-3">
          <label className="text-xs text-muted-foreground">
            Cached project
            <select
              aria-label="Cached project"
              value={id}
              onChange={(event) => {
                setId(event.target.value)
                setPath(
                  workspaces.find((entry) => entry.id === event.target.value)
                    ?.workspace.selectedFile ?? '',
                )
              }}
              className="my-3 block w-full rounded border bg-background p-2"
            >
              <option value="">Choose a project</option>
              {workspaces.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id}
                </option>
              ))}
            </select>
          </label>
          {paths.map((file) => (
            <button
              key={file}
              onClick={() => setPath(file)}
              className={`block w-full truncate rounded px-2 py-1.5 text-left text-xs ${file === path ? 'bg-accent' : 'hover:bg-accent'}`}
            >
              {file}
            </button>
          ))}
        </aside>
        <main className="relative min-w-0 flex-1">
          {current ? (
            <WorkspaceEditor
              key={id}
              workspaceId={id}
              template={current.workspace.template ?? 'vexcode'}
              selectedFile={path}
              loadSnapshot={() => Promise.reject(new Error('Offline'))}
              commitChanges={() =>
                Promise.reject(
                  new Error(
                    'Reconnect to commit your changes. Drafts remain saved on this device.',
                  ),
                )
              }
              onSelect={setPath}
              onPathsChange={setPaths}
              onDirtyChange={() => {}}
              onSavingChange={() => {}}
              saveHandlerRef={saveHandlerRef}
            />
          ) : (
            <div className="p-8 text-sm text-muted-foreground">
              {error ||
                (workspaces.length
                  ? 'Choose a cached project. Editing and language intelligence run locally; commits and builds require a connection.'
                  : 'No cached projects are available. Open a project online first to cache its source and language assets.')}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<OfflineWorkspace />)
