import * as React from 'react'
import { TerminalIcon } from '@phosphor-icons/react'
import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAction } from 'convex/react'
import { releaseBrowserCompiler } from '@v5x/compiler'
import { simulatorTemplate } from '@v5x/simulator'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { BrainUploadPopover } from '~/components/ide/brain-upload-popover'
import { CompilationServerDialog } from '~/components/ide/compilation-server-dialog'
import { ProgramSidebar } from '~/components/ide/program-sidebar'
import {
  BuildButton,
  BuildSettingsMenu,
  CommitButton,
  SimulatorButton,
  StatusMessages,
  describeBuildElapsed,
} from '~/components/ide/program-status-bar'
import { WorkspaceEditor } from '~/components/ide/workspace-editor'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '~/components/ui/empty'
import { SidebarInset, SidebarProvider } from '~/components/ui/sidebar'
import { Skeleton } from '~/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '~/components/ui/tooltip'
import { useBrain } from '~/hooks/use-brain'
import { useBrainSlot } from '~/hooks/use-brain-slot'
import { useCompilationServer } from '~/hooks/use-compilation-server'
import { useProgramBuild } from '~/hooks/use-program-build'
import { useProgramFiles } from '~/hooks/use-program-files'
import { useSimulatorHandoff } from '~/hooks/use-simulator-handoff'
import { selectUploadArtifacts } from '~/lib/ide/brain-upload'
import type { FileOperations } from '~/lib/ide/file-operations'
import { hasSimulatorArtifacts } from '~/lib/ide/simulator-handoff'
import type { ProjectSnapshot } from '~/lib/ide/workspace'

const emptyPaths: Array<string> = []

// Mount with `key={programId}` so every program starts from fresh state.
export function ProgramWorkspace({ programId }: { programId: Id<'program'> }) {
  const navigate = useNavigate()

  const { data: program, isPending: programIsPending } = useQuery(
    convexQuery(api.program.get, { programId }),
  )

  const loadWorkspace = useAction(api.program.getWorkspaceSnapshot)
  const commitWorkspace = useAction(api.program.commitWorkspace)
  const files = useProgramFiles(programId)
  const compilationServer = useCompilationServer()
  const brain = useBrain()
  const [brainSlot, setBrainSlot] = useBrainSlot(programId)
  const simulator = useSimulatorHandoff(programId)

  const [selectedFile, setSelectedFile] = React.useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [serialSupported, setSerialSupported] = React.useState(false)
  const [compilationServerOpen, setCompilationServerOpen] =
    React.useState(false)
  const [outputRequest, setOutputRequest] = React.useState(0)

  const fileOperationsRef = React.useRef<FileOperations | null>(null)
  const saveHandlerRef = React.useRef<(() => Promise<void>) | null>(null)
  const buildSnapshotRef = React.useRef<(() => ProjectSnapshot) | null>(null)

  const template = program?.template ?? 'vexcode'
  const currentCommitSha = program?.currentCommitSha

  const programBuild = useProgramBuild({
    programId,
    template,
    currentCommitSha,
    compilationServer: compilationServer.endpoint,
    compilationServerLoaded: compilationServer.loaded,
    save: async () => {
      if (!saveHandlerRef.current)
        throw new Error('Wait for the workspace to load.')
      await saveHandlerRef.current()
    },
    snapshot: () => buildSnapshotRef.current?.(),
    onStart: () => brain.setMessage(''),
  })

  React.useEffect(() => {
    setSerialSupported('serial' in navigator)
  }, [])

  React.useEffect(() => {
    if (!hasUnsavedChanges) return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [hasUnsavedChanges])

  const artifacts = programBuild.artifacts
  const artifactsCurrent =
    !!artifacts && artifacts.commitSha === currentCommitSha
  const isBusy = isSaving || brain.isUploading

  const buildFiles = React.useMemo(
    () => (artifacts ? [...artifacts.byPath.keys()] : emptyPaths),
    [artifacts],
  )

  const treePaths = React.useMemo(
    () =>
      files.paths === null
        ? null
        : [...new Set([...files.paths, ...buildFiles])],
    [files.paths, buildFiles],
  )

  const firstFile = files.paths?.includes('src/main.cpp')
    ? 'src/main.cpp'
    : (files.paths?.at(0) ?? buildFiles.at(0))

  const activeFile =
    selectedFile === ''
      ? ''
      : selectedFile && treePaths?.includes(selectedFile)
        ? selectedFile
        : firstFile
  const showingArtifact = !!activeFile && buildFiles.includes(activeFile)

  const build = () => {
    if (!program || isBusy) return
    void programBuild.build()
  }

  const uploadUnavailableReason =
    hasUnsavedChanges || isSaving
      ? 'Commit changes before uploading.'
      : programBuild.isBuilding
        ? 'Wait for the build to finish.'
        : !artifactsCurrent || artifacts.byPath.size === 0
          ? 'Build the program before uploading.'
          : ''

  const upload = () => {
    if (!program || !artifactsCurrent || hasUnsavedChanges) return
    if (isBusy || programBuild.isBuilding) return

    const selected = selectUploadArtifacts(artifacts.byPath, activeFile)
    if (!selected) return

    void brain.upload({
      ...selected,
      name: program.name,
      slot: brainSlot,
      template,
    })
  }

  const canSimulate = simulatorTemplate(template)

  const simulatorDisabled =
    !program ||
    !canSimulate ||
    !artifactsCurrent ||
    !hasSimulatorArtifacts(template, artifacts.byPath) ||
    programBuild.isBuilding ||
    isBusy ||
    simulator.isHandingOff ||
    hasUnsavedChanges

  const runInSimulator = () => {
    if (simulatorDisabled || !currentCommitSha || !canSimulate) return
    void simulator.run({
      template,
      currentCommitSha,
      snapshot: buildSnapshotRef.current?.(),
      artifacts: artifacts.byPath,
    })
  }

  const buildLabel = programBuild.isBuilding
    ? `Building program, ${describeBuildElapsed(programBuild.elapsedSeconds)} elapsed`
    : hasUnsavedChanges || isSaving
      ? 'Save and build program'
      : !currentCommitSha
        ? 'Loading build status'
        : programBuild.message ||
          (compilationServer.endpoint
            ? 'Build on compilation server'
            : 'Build program')

  const statusBarEnd = (
    <>
      <CommitButton
        disabled={!hasUnsavedChanges || isSaving || !saveHandlerRef.current}
        onCommit={() => {
          // The workspace displays save failures.
          void saveHandlerRef.current?.().catch(() => {})
        }}
      />
      <BuildButton
        isBuilding={programBuild.isBuilding}
        elapsedSeconds={programBuild.elapsedSeconds}
        label={buildLabel}
        disabled={!program || !currentCommitSha || isBusy}
        onBuild={build}
        onCancel={programBuild.cancel}
      />
      <BrainUploadPopover
        isConnected={brain.isConnected}
        isUploading={brain.isUploading}
        serialSupported={serialSupported}
        unavailableReason={uploadUnavailableReason}
        slot={brainSlot}
        onSlotChange={setBrainSlot}
        message={brain.message}
        onUpload={upload}
        onDisconnect={() => void brain.disconnect()}
      />
      <SimulatorButton
        supported={canSimulate}
        disabled={simulatorDisabled}
        busy={simulator.isHandingOff}
        onRun={runInSimulator}
      />
      <BuildSettingsMenu
        remote={!!compilationServer.endpoint}
        disabled={programBuild.isBuilding}
        onOpenCompilationServer={() => setCompilationServerOpen(true)}
        onResetBrowserCompiler={releaseBrowserCompiler}
      />
      {programBuild.message.startsWith('Build failed') && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="View build output"
                onClick={() => setOutputRequest((request) => request + 1)}
              />
            }
          >
            <TerminalIcon />
          </TooltipTrigger>
          <TooltipContent>View build output</TooltipContent>
        </Tooltip>
      )}
      <StatusMessages
        messages={[
          programBuild.isBuilding
            ? `Building ${compilationServer.endpoint ? 'remotely' : 'in browser'} · ${programBuild.elapsedSeconds}s`
            : programBuild.message,
          brain.message,
          simulator.message,
          brain.isConnected ? 'Brain connected' : 'Brain disconnected',
          compilationServer.endpoint
            ? 'Building remotely'
            : 'Building in browser',
        ]}
      />
    </>
  )

  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <ProgramSidebar
        programName={program?.name}
        paths={treePaths}
        readOnlyPaths={buildFiles}
        selectedFile={activeFile ?? ''}
        fileOperationsRef={fileOperationsRef}
        treeDisabled={isBusy || programBuild.isBuilding}
        backDisabled={isBusy}
        onBack={() => {
          if (isBusy) return
          if (
            hasUnsavedChanges &&
            !window.confirm(
              'Leave with uncommitted changes? Commit first to keep your work in Git.',
            )
          )
            return
          void navigate({ to: '/' })
        }}
        onSelect={(path) => {
          if (isBusy) return false
          setSelectedFile(path)
          return true
        }}
      />

      <SidebarInset className="relative flex h-svh min-h-0 flex-col overflow-hidden">
        <Alert className="m-2 w-auto md:hidden">
          <AlertDescription>
            Use a desktop browser for the full editor, build, and upload
            workflow.
          </AlertDescription>
        </Alert>
        {programBuild.isBuilding &&
          !compilationServer.endpoint &&
          programBuild.firstBrowserBuild && (
            <Alert className="m-2 w-auto">
              <AlertDescription>
                The first browser build downloads the compiler once. Later
                builds reuse the cached compiler.
              </AlertDescription>
            </Alert>
          )}
        {files.error ? (
          <Alert>
            <AlertDescription>{files.error}</AlertDescription>
            <Button variant="outline" onClick={files.retry}>
              Retry
            </Button>
          </Alert>
        ) : programIsPending || files.paths === null ? (
          <div className="grid flex-1 place-items-center">
            <Skeleton className="h-32 w-3/4" />
          </div>
        ) : !program ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Program not found.</EmptyTitle>
              <EmptyDescription>
                Return to programs to choose another project.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {showingArtifact && (
              <div className="p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Build artifact</p>
                <p className="mt-1">{activeFile}</p>
                <p className="mt-2">Temporary output; not committed to Git.</p>
              </div>
            )}
            <div className={showingArtifact ? 'hidden' : 'min-h-0 flex-1'}>
              <WorkspaceEditor
                onBuild={build}
                outputRequest={outputRequest}
                statusBarEnd={statusBarEnd}
                workspaceId={programId}
                languageServer={
                  compilationServer.loaded ? compilationServer.endpoint : null
                }
                template={template}
                commitSha={currentCommitSha}
                buildOutput={programBuild.output}
                buildSnapshotRef={buildSnapshotRef}
                brainTerminal={{
                  brainDevice: brain.device,
                  connectBrain: brain.connect,
                  disconnectBrain: brain.disconnect,
                  isUploading: brain.isUploading,
                }}
                loadSnapshot={() => loadWorkspace({ programId })}
                commitChanges={async (changes, expectedCommitSha, message) => {
                  const sha = await commitWorkspace({
                    programId,
                    changes,
                    expectedCommitSha,
                    message,
                  })
                  programBuild.noteCommit(sha)
                  return sha
                }}
                onSelect={setSelectedFile}
                onPathsChange={files.setPaths}
                selectedFile={activeFile ?? ''}
                onDirtyChange={setHasUnsavedChanges}
                onSavingChange={setIsSaving}
                saveHandlerRef={saveHandlerRef}
                fileOperationsRef={fileOperationsRef}
              />
            </div>
          </>
        )}
      </SidebarInset>
      <CompilationServerDialog
        open={compilationServerOpen}
        onOpenChange={setCompilationServerOpen}
        endpoint={compilationServer.endpoint}
        onConnect={compilationServer.connect}
      />
    </SidebarProvider>
  )
}
