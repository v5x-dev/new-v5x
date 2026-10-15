import * as React from 'react'
import { isDirty, liveDocuments, type Documents } from '~/lib/ide/workspace'

// Paths edited since the language server last saw the workspace. `full`
// means everything needs to be resynchronised.
export interface PendingSync {
  full: boolean
  paths: Set<string>
}

// The live documents are kept in a ref so editor callbacks always read the
// latest text. React state follows in a transition, and the revision counters
// let memoised children re-render only for the changes they show.
export function useWorkspaceDocuments() {
  const [documents, setDocuments] = React.useState<Documents>({})
  const [documentRevision, setDocumentRevision] = React.useState(0)
  const [workspaceDirty, setWorkspaceDirty] = React.useState(false)
  const [dirtyRevision, setDirtyRevision] = React.useState(0)
  const [pathsRevision, setPathsRevision] = React.useState(0)

  const documentsRef = React.useRef(documents)
  const editGenerationRef = React.useRef(0)
  const dirtyPathsRef = React.useRef(new Set<string>())
  const workspacePathsRef = React.useRef<Array<string>>([])
  const pendingSyncRef = React.useRef<PendingSync>({
    full: false,
    paths: new Set(),
  })

  const actions = React.useMemo(() => {
    const bumpDocuments = () => setDocumentRevision((revision) => revision + 1)

    const refreshDirtyPaths = (next: Documents) => {
      dirtyPathsRef.current = new Set(
        Object.values(next).flatMap((doc) =>
          doc && isDirty(doc) ? [doc.path] : [],
        ),
      )
      setWorkspaceDirty(dirtyPathsRef.current.size > 0)
    }

    const refreshWorkspacePaths = (next: Documents) => {
      const paths = liveDocuments(next)
        .map((doc) => doc.path)
        .sort()
      const current = workspacePathsRef.current

      if (
        paths.length === current.length &&
        paths.every((path, index) => path === current[index])
      )
        return

      workspacePathsRef.current = paths
      setPathsRevision((revision) => revision + 1)
    }

    return {
      // Initial documents must land with the loaded flag, not in a later
      // transition.
      load(next: Documents) {
        documentsRef.current = next
        setDocuments(next)
        bumpDocuments()
        refreshDirtyPaths(next)
        refreshWorkspacePaths(next)
      },

      // Replaces every document and schedules a full language server sync.
      publish(next: Documents, options: { pathsChanged?: boolean } = {}) {
        pendingSyncRef.current.full = true
        pendingSyncRef.current.paths.clear()

        documentsRef.current = next
        refreshDirtyPaths(next)
        if (options.pathsChanged) refreshWorkspacePaths(next)
        React.startTransition(() => {
          setDocuments(next)
          bumpDocuments()
        })
      },

      // Records one editor change without copying the document map.
      publishEdit(path: string, contents: string) {
        const current = documentsRef.current[path]
        if (!current || current.deleted || current.contents === contents) return

        const updated = { ...current, contents, version: current.version + 1 }
        documentsRef.current[path] = updated
        editGenerationRef.current++

        if (!pendingSyncRef.current.full) pendingSyncRef.current.paths.add(path)

        const wasDirty = dirtyPathsRef.current.has(path)
        const nowDirty = isDirty(updated)

        if (nowDirty) dirtyPathsRef.current.add(path)
        else dirtyPathsRef.current.delete(path)

        if (wasDirty !== nowDirty) {
          setDirtyRevision((revision) => revision + 1)
          setWorkspaceDirty(dirtyPathsRef.current.size > 0)
        }

        React.startTransition(() => {
          setDocuments(documentsRef.current)
          bumpDocuments()
        })
      },

      resetSync() {
        pendingSyncRef.current = { full: false, paths: new Set() }
      },
    }
  }, [])

  return {
    documents,
    documentRevision,
    workspaceDirty,
    dirtyRevision,
    pathsRevision,
    documentsRef,
    editGenerationRef,
    workspacePathsRef,
    pendingSyncRef,
    ...actions,
  }
}

export type WorkspaceDocumentStore = ReturnType<typeof useWorkspaceDocuments>
