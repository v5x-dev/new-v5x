import { convexQuery } from '@convex-dev/react-query'
import {
  getFiletypeFromFileName,
  preloadHighlighter,
  type FileEditCompleteHandler,
  type FileOptions,
} from '@pierre/diffs'
import { Editor, type EditorFactory } from '@pierre/diffs/edit'
import { EditProvider, File } from '@pierre/diffs/react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAction } from 'convex/react'
import { ArrowLeftIcon, GitCommitIcon, HammerIcon } from '@phosphor-icons/react'
import * as React from 'react'
import type { CSSProperties } from 'react'
import type { Id } from '../../../../convex/_generated/dataModel'
import { api } from '../../../../convex/_generated/api'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from '~/components/ui/sidebar'
import { birdsOfParadiseTheme } from '~/lib/birds-of-paradise-theme'

const createFileEditor: EditorFactory<undefined, undefined> = (
  editorType,
  options,
  editStateKey,
) => new Editor(editorType, options, editStateKey)

const programFileOptions = {
  theme: birdsOfParadiseTheme,
  themeType: 'dark',
  preferredHighlighter: 'shiki-js',
  disableFileHeader: true,
  disableLineNumbers: false,
} satisfies FileOptions<undefined, undefined>

const programFileStyle = {
  '--diffs-font-family': 'var(--font-mono)',
} as CSSProperties

const rejectUncommittedEdit: FileEditCompleteHandler<
  undefined,
  undefined
> = () => 'reject'

export const Route = createFileRoute('/_app/p/$programId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { programId: rawProgramId } = Route.useParams()
  const navigate = useNavigate()
  const programId = rawProgramId as Id<'program'>
  const { data: program, isPending: programIsPending } = useQuery(
    convexQuery(api.program.get, { programId }),
  )
  const getProgramFiles = useAction(api.program.getProgramFiles)
  const buildProgram = useAction(api.programBuild.build)
  const [paths, setPaths] = React.useState<string[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null)
  const [buildFiles, setBuildFiles] = React.useState<string[]>([])
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isBuilding, setIsBuilding] = React.useState(false)
  const [buildMessage, setBuildMessage] = React.useState('')
  const saveHandlerRef = React.useRef<(() => Promise<void>) | null>(null)

  const build = async () => {
    if (!program || hasUnsavedChanges || isSaving || isBuilding) return

    setIsBuilding(true)
    setBuildMessage('')
    setBuildFiles([])
    try {
      const result = await buildProgram({ programId })
      if (result.exitCode === 0) {
        setBuildMessage('Build succeeded')
        setBuildFiles(result.binFiles)
      } else {
        setBuildMessage(`Build failed (exit code ${result.exitCode})`)
        console.error('VEX V5 build failed:', result.stderr)
      }
    } catch (error) {
      setBuildMessage('Build failed')
      console.error('VEX V5 build failed:', error)
    } finally {
      setIsBuilding(false)
    }
  }

  React.useEffect(() => {
    let isCurrent = true
    setPaths(null)
    setLoadError(null)
    setSelectedFile(null)
    setBuildFiles([])
    setBuildMessage('')

    getProgramFiles({ programId })
      .then((nextPaths) => {
        if (isCurrent) setPaths(nextPaths)
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Could not load program files.',
          )
        }
      })

    return () => {
      isCurrent = false
    }
  }, [getProgramFiles, programId])

  const treePaths =
    paths === null ? null : [...new Set([...paths, ...buildFiles])]
  const firstFile = paths?.includes('src/main.cpp')
    ? 'src/main.cpp'
    : (paths?.[0] ?? buildFiles[0] ?? '')
  const activeFile =
    selectedFile && treePaths?.includes(selectedFile) ? selectedFile : firstFile
  const buildButtonLabel = isBuilding
    ? 'Building program'
    : hasUnsavedChanges || isSaving
      ? 'Commit changes before building'
      : buildMessage || 'Build program'

  return (
    <EditProvider createEditor={createFileEditor}>
      <SidebarProvider className="h-svh min-h-0 overflow-hidden">
        <Sidebar variant="floating">
          {program ? (
            <SidebarHeader className="gap-0 pb-0 px-4">
              <span className="truncate text-xs text-muted-foreground py-1">
                {program.name}
              </span>
            </SidebarHeader>
          ) : null}
          <SidebarContent className="min-h-0 p-0">
            {treePaths?.length ? (
              <ProgramFileTree
                key={JSON.stringify(treePaths)}
                paths={treePaths ?? paths}
                selectedFile={activeFile}
                onSelect={(path) => {
                  if (isSaving) return false
                  if (
                    path !== activeFile &&
                    hasUnsavedChanges &&
                    !window.confirm('Discard unsaved changes and switch files?')
                  ) {
                    return false
                  }
                  if (path !== activeFile) setHasUnsavedChanges(false)
                  setSelectedFile(path)
                  return true
                }}
              />
            ) : null}
          </SidebarContent>
          <SidebarFooter className="flex-row justify-between">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Back to programs"
              title="Back to programs"
              onClick={() => {
                if (isSaving) return
                if (
                  hasUnsavedChanges &&
                  !window.confirm('Discard unsaved changes and go back?')
                ) {
                  return
                }
                void navigate({ to: '/' })
              }}
            >
              <ArrowLeftIcon />
            </Button>
            <div className="flex flex-row gap-0.5 items-center">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Commit changes"
                title="Commit changes"
                onClick={() => {
                  const save = saveHandlerRef.current
                  if (save) void save()
                }}
                disabled={
                  !hasUnsavedChanges ||
                  isSaving ||
                  saveHandlerRef.current === null
                }
              >
                <GitCommitIcon />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={buildButtonLabel}
                title={buildButtonLabel}
                onClick={() => void build()}
                disabled={
                  !program || isBuilding || isSaving || hasUnsavedChanges
                }
              >
                {isBuilding ? <Spinner /> : <HammerIcon />}
              </Button>
            </div>
            <span className="sr-only" role="status" aria-live="polite">
              {buildMessage}
            </span>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="h-svh min-h-0 overflow-auto">
          {programIsPending || paths === null ? (
            <div className="grid h-full place-items-center">
              <Spinner />
            </div>
          ) : loadError ? (
            <p className="p-4 text-sm text-muted-foreground">{loadError}</p>
          ) : !program ? (
            <p className="p-4 text-sm text-muted-foreground">
              Program not found.
            </p>
          ) : paths.length === 0 && buildFiles.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No files.</p>
          ) : buildFiles.includes(activeFile) ? (
            <div className="p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Build artifact</p>
              <p className="mt-1">{activeFile}</p>
              <p className="mt-2">Temporary output; not committed to Git.</p>
            </div>
          ) : (
            <ProgramEditor
              key={programId}
              programId={programId}
              selectedFile={activeFile}
              onDirtyChange={setHasUnsavedChanges}
              onSavingChange={setIsSaving}
              saveHandlerRef={saveHandlerRef}
            />
          )}
        </SidebarInset>
      </SidebarProvider>
    </EditProvider>
  )
}

function ProgramFileTree({
  paths,
  selectedFile,
  onSelect,
}: {
  paths: string[]
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

function ProgramEditor({
  programId,
  selectedFile,
  onDirtyChange,
  onSavingChange,
  saveHandlerRef,
}: {
  programId: Id<'program'>
  selectedFile: string
  onDirtyChange: (dirty: boolean) => void
  onSavingChange: (saving: boolean) => void
  saveHandlerRef: { current: (() => Promise<void>) | null }
}) {
  const getProgramFile = useAction(api.program.getProgramFile)
  const saveProgramFile = useAction(api.program.saveProgramFile)
  const [source, setSource] = React.useState<string | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [readyFile, setReadyFile] = React.useState<string | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const savedContentsRef = React.useRef<string | null>(null)
  const draftRef = React.useRef('')
  const currentFileRef = React.useRef(selectedFile)
  const isSavingRef = React.useRef(false)

  currentFileRef.current = selectedFile

  React.useEffect(() => {
    let isCurrent = true
    savedContentsRef.current = null
    setSource(null)
    setLoadError(null)
    setSaveError(null)
    isSavingRef.current = false
    onSavingChange(false)
    draftRef.current = ''
    onDirtyChange(false)

    getProgramFile({ programId, path: selectedFile })
      .then((contents) => {
        if (isCurrent) {
          savedContentsRef.current = contents
          draftRef.current = contents
          setSource(contents)
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Could not load this file.',
          )
        }
      })

    return () => {
      isCurrent = false
    }
  }, [getProgramFile, onDirtyChange, onSavingChange, programId, selectedFile])

  React.useEffect(() => {
    let isCurrent = true
    setReadyFile(null)

    preloadHighlighter({
      langs: [getFiletypeFromFileName(selectedFile)],
      themes: [birdsOfParadiseTheme],
      preferredHighlighter: 'shiki-js',
    })
      .then(() => {
        if (isCurrent) setReadyFile(selectedFile)
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Could not prepare the code viewer.',
          )
        }
      })

    return () => {
      isCurrent = false
    }
  }, [selectedFile])

  const handleEditChange = React.useCallback(
    (event: { file: { contents: string } }) => {
      draftRef.current = event.file.contents
      const dirty = event.file.contents !== savedContentsRef.current
      onDirtyChange(dirty)
    },
    [onDirtyChange],
  )

  const saveChanges = React.useCallback(async () => {
    if (
      isSavingRef.current ||
      savedContentsRef.current === null ||
      draftRef.current === savedContentsRef.current
    ) {
      return
    }

    const path = selectedFile
    const contents = draftRef.current
    isSavingRef.current = true
    onSavingChange(true)
    setSaveError(null)

    try {
      await saveProgramFile({ programId, path, contents })
      if (currentFileRef.current !== path) return

      savedContentsRef.current = contents
      const dirty = draftRef.current !== contents
      onDirtyChange(dirty)
    } catch (error) {
      if (currentFileRef.current === path) {
        setSaveError(
          error instanceof Error ? error.message : 'Could not save this file.',
        )
      }
    } finally {
      if (currentFileRef.current === path) {
        isSavingRef.current = false
        onSavingChange(false)
      }
    }
  }, [onDirtyChange, onSavingChange, programId, saveProgramFile, selectedFile])

  React.useEffect(() => {
    const isReady = source !== null && readyFile === selectedFile
    saveHandlerRef.current = isReady ? saveChanges : null

    return () => {
      if (saveHandlerRef.current === saveChanges) saveHandlerRef.current = null
    }
  }, [readyFile, saveChanges, saveHandlerRef, selectedFile, source])

  const file = React.useMemo(
    () => ({ name: selectedFile, contents: source ?? '' }),
    [selectedFile, source],
  )

  if (loadError) {
    return <p className="p-4 text-sm text-muted-foreground">{loadError}</p>
  }

  if (source === null || readyFile !== selectedFile) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {saveError ? (
        <p className="px-3 py-2 text-sm text-destructive" role="alert">
          {saveError}
        </p>
      ) : null}
      <File
        file={file}
        edit
        onEditChange={handleEditChange}
        onEditComplete={rejectUncommittedEdit}
        options={programFileOptions}
        className="block min-h-0 flex-1"
        style={programFileStyle}
      />
    </div>
  )
}
