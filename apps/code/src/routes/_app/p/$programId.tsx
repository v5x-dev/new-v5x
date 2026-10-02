import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAction } from 'convex/react'
import {
  ArrowLeftIcon,
  GitCommitIcon,
  HammerIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react'
import * as React from 'react'
import {
  FileExitAction,
  ProgramIniConfig,
  V5SerialConnection,
  V5SerialDevice,
} from '@v5x/serial'
import { createBrowserAdapter } from '@v5x/serial/browser'
import { api } from '../../../../convex/_generated/api'
import type { AdapterSerialPort } from '@v5x/serial'
import type { Id } from '../../../../convex/_generated/dataModel'
import { WorkspaceEditor } from '~/components/ide/workspace-editor'
import { ProgramFileTree } from '~/components/ide/program-file-tree'
import { Button } from '~/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '~/components/ui/popover'
import { Separator } from '~/components/ui/separator'
import { Spinner } from '~/components/ui/spinner'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from '~/components/ui/sidebar'
import { parseProgramFilePaths } from '~/lib/program-files'

function formatBuildElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

function describeBuildElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  const minuteLabel = minutes === 1 ? 'minute' : 'minutes'
  const secondLabel = remainingSeconds === 1 ? 'second' : 'seconds'
  if (minutes === 0) return `${remainingSeconds} ${secondLabel}`

  const remainingTime =
    remainingSeconds === 0 ? '' : `, ${remainingSeconds} ${secondLabel}`

  return `${minutes} ${minuteLabel}${remainingTime}`
}

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
  const { data: hasBuildForCurrentCommit, isPending: buildStatusIsPending } =
    useQuery(
      convexQuery(api.program.hasRunForCommit, {
        programId,
        commitSha: program?.currentCommitSha ?? '',
      }),
    )
  const { data: cachedBuild } = useQuery(
    convexQuery(api.programBuildCache.getLatest, {
      programId,
      commitSha: program?.currentCommitSha ?? '',
    }),
  )
  const getProgramFiles = useAction(api.program.getProgramFiles)
  const buildProgram = useAction(api.programBuild.build)
  const loadWorkspace = useAction(api.program.getWorkspaceSnapshot)
  const commitWorkspace = useAction(api.program.commitWorkspace)
  const [paths, setPaths] = React.useState<Array<string> | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null)
  const [buildFiles, setBuildFiles] = React.useState<Array<string>>([])
  const [buildArtifacts, setBuildArtifacts] = React.useState<
    Map<string, Uint8Array>
  >(() => new Map())
  const [buildArtifactsCommitSha, setBuildArtifactsCommitSha] = React.useState<
    string | null
  >(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isBuilding, setIsBuilding] = React.useState(false)
  const [buildStartedAt, setBuildStartedAt] = React.useState<number | null>(
    null,
  )
  const [buildElapsedSeconds, setBuildElapsedSeconds] = React.useState(0)
  const [isUploading, setIsUploading] = React.useState(false)
  const [brainSlot, setBrainSlot] = React.useState(1)
  const [buildMessage, setBuildMessage] = React.useState('')
  const [buildOutput, setBuildOutput] = React.useState('')
  const [uploadMessage, setUploadMessage] = React.useState('')
  const [isBrainConnected, setIsBrainConnected] = React.useState(false)
  const brainConnectionRef = React.useRef<{
    device: V5SerialDevice
    port: AdapterSerialPort
    onDisconnect: () => void
  } | null>(null)
  const saveHandlerRef = React.useRef<(() => Promise<void>) | null>(null)
  const buildGenerationRef = React.useRef(0)
  const restoredBuildCommitRef = React.useRef<string | null>(null)
  const currentCommitShaRef = React.useRef(program?.currentCommitSha)

  React.useEffect(() => {
    currentCommitShaRef.current = program?.currentCommitSha
  }, [program?.currentCommitSha])

  const disconnectBrain = async () => {
    const connection = brainConnectionRef.current
    brainConnectionRef.current = null
    setIsBrainConnected(false)
    if (!connection) return
    connection.port.removeEventListener?.('disconnect', connection.onDisconnect)
    try {
      await connection.device.dispose()
    } finally {
      await connection.port.forget?.()
    }
  }

  const build = async () => {
    if (
      !program?.currentCommitSha ||
      hasBuildForCurrentCommit ||
      buildStatusIsPending ||
      hasUnsavedChanges ||
      isSaving ||
      isBuilding ||
      isUploading
    )
      return

    const started = performance.now()
    const browserTimings: Array<{ stage: string; ms: number }> = []
    let serverTimings: Array<{ stage: string; ms: number }> = []
    const measure = async <T,>(stage: string, work: () => Promise<T>) => {
      const stageStarted = performance.now()
      try {
        return await work()
      } finally {
        browserTimings.push({
          stage,
          ms: Math.round(performance.now() - stageStarted),
        })
      }
    }

    buildGenerationRef.current++
    setBuildStartedAt(started)
    setBuildElapsedSeconds(0)
    setIsBuilding(true)
    setBuildMessage('')
    setUploadMessage('')
    setBuildFiles([])
    setBuildArtifacts(new Map())
    setBuildArtifactsCommitSha(null)
    try {
      const result = await measure('Build action round trip', () =>
        buildProgram({ programId }),
      )
      serverTimings = result.timings
      setBuildOutput([result.stdout, result.stderr].filter(Boolean).join('\n'))
      if (result.commitSha !== currentCommitShaRef.current) return
      if (result.exitCode === 0) {
        setBuildFiles(result.binFiles)
        try {
          const artifacts = await measure('Download all artifacts', () =>
            Promise.all(
              result.artifacts.map(({ path, url }) =>
                measure(`Download ${path}`, async () => {
                  const response = await fetch(url)
                  if (!response.ok) {
                    throw new Error(`Could not download ${path}`)
                  }
                  return [
                    path,
                    new Uint8Array(await response.arrayBuffer()),
                  ] as const
                }),
              ),
            ),
          )
          if (result.commitSha !== currentCommitShaRef.current) return
          setBuildArtifacts(new Map(artifacts))
          setBuildArtifactsCommitSha(result.commitSha)
          setBuildMessage(
            result.binFiles.length > 0
              ? 'Build succeeded'
              : 'Build succeeded, no .bin files found',
          )
        } catch (error) {
          setBuildMessage('Build succeeded, but artifacts could not be loaded')
          console.error('Could not load VEX V5 build artifacts:', error)
        }
      } else {
        setBuildMessage(`Build failed (exit code ${result.exitCode})`)
        console.error('VEX V5 build failed:', result.stderr)
      }
    } catch (error) {
      setBuildMessage('Build failed')
      console.error('VEX V5 build failed:', error)
    } finally {
      setBuildStartedAt(null)
      setIsBuilding(false)
      console.info(`VEX V5 build timings for ${programId}`)
      console.table([
        ...serverTimings.map((timing) => ({ source: 'server', ...timing })),
        ...browserTimings.map((timing) => ({ source: 'browser', ...timing })),
        {
          source: 'browser',
          stage: 'Total build click to ready',
          ms: Math.round(performance.now() - started),
        },
      ])
    }
  }

  const uploadToBrain = async () => {
    if (
      !program ||
      buildArtifactsCommitSha !== program.currentCommitSha ||
      hasUnsavedChanges ||
      isSaving ||
      isBuilding ||
      isUploading
    )
      return

    const hotPath = buildFiles.find((path) => path.endsWith('hot.package.bin'))
    const programPath =
      activeFile &&
      buildArtifacts.has(activeFile) &&
      !activeFile.endsWith('cold.package.bin')
        ? activeFile
        : (hotPath ??
          buildFiles.find((path) => !path.endsWith('cold.package.bin')))
    const programBytes = programPath
      ? buildArtifacts.get(programPath)
      : undefined
    if (!programPath || !programBytes) return

    const coldPath = programPath.endsWith('hot.package.bin')
      ? buildFiles.find((path) => path.endsWith('cold.package.bin'))
      : undefined
    const coldBytes = coldPath ? buildArtifacts.get(coldPath) : undefined

    setIsUploading(true)
    setUploadMessage('Connecting to Brain')
    try {
      let connection = brainConnectionRef.current
      if (!connection) {
        const port = await createBrowserAdapter().requestPort({
          filters: [{ usbVendorId: 10376 }],
        })
        const device = new V5SerialDevice(
          {
            getPorts: () => Promise.resolve([port]),
            requestPort: () => Promise.resolve(port),
          },
          { autoRefresh: false },
        )
        const serialConnection = new V5SerialConnection({
          getPorts: () => Promise.resolve([port]),
          requestPort: () => Promise.resolve(port),
        })
        device.autoReconnect = false
        try {
          if (!(await serialConnection.open(0, false))) {
            throw new Error(
              'Could not open the selected Brain serial port. Close VEXcode or another app using the Brain, then retry.',
            )
          }
          if (!(await device.connect(serialConnection))) {
            throw new Error(
              'The Brain serial port opened, but the Brain did not respond to the V5 handshake.',
            )
          }
          const onDisconnect = () => {
            if (brainConnectionRef.current?.port !== port) return
            brainConnectionRef.current = null
            setIsBrainConnected(false)
            setUploadMessage('Brain disconnected')
            void device.dispose()
          }
          port.addEventListener('disconnect', onDisconnect)
          connection = { device, port, onDisconnect }
          brainConnectionRef.current = connection
          setIsBrainConnected(true)
        } catch (error) {
          await device.dispose()
          await serialConnection.close()
          throw error
        }
      }
      try {
        const ini = new ProgramIniConfig()
        ini.baseName = `slot_${brainSlot}`
        ini.program.name = program.name
        ini.program.slot = (brainSlot - 1) as typeof ini.program.slot
        ini.program.description = 'Built with v5x'
        ini.project.ide = 'VEXcode'
        ini.autorun = false
        ini.after = FileExitAction.EXIT_NONE
        ini.setProgramDate(new Date())

        const uploaded = await connection.device.brain.uploadProgram(
          ini,
          programBytes,
          coldBytes,
          (state, current, total) => {
            const percent = total > 0 ? Math.round((current / total) * 100) : 0
            setUploadMessage(`Uploading ${state} ${percent}%`)
          },
        )
        if (uploaded !== true) {
          throw new Error('Upload failed. Check the Brain connection.')
        }
        setUploadMessage(`Uploaded to slot ${brainSlot}`)
      } catch (error) {
        if (!connection.device.isConnected) await disconnectBrain()
        throw error
      }
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Upload failed')
      console.error('VEX V5 upload failed:', error)
    } finally {
      setIsUploading(false)
    }
  }

  React.useEffect(() => {
    if (!isBuilding || buildStartedAt === null) return

    const updateElapsedTime = () => {
      setBuildElapsedSeconds(
        Math.floor((performance.now() - buildStartedAt) / 1000),
      )
    }
    const interval = window.setInterval(updateElapsedTime, 1000)
    return () => window.clearInterval(interval)
  }, [buildStartedAt, isBuilding])

  React.useEffect(() => {
    let isCurrent = true
    buildGenerationRef.current++
    setPaths(null)
    setLoadError(null)
    setSelectedFile(null)
    setBuildFiles([])
    setBuildArtifacts(new Map())
    setBuildArtifactsCommitSha(null)
    setBuildMessage('')
    setUploadMessage('')

    getProgramFiles({ programId })
      .then((result) => {
        if (isCurrent) setPaths(parseProgramFilePaths(result))
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
      const connection = brainConnectionRef.current
      brainConnectionRef.current = null
      if (connection) {
        connection.port.removeEventListener?.(
          'disconnect',
          connection.onDisconnect,
        )
        void connection.device.dispose()
      }
    }
  }, [getProgramFiles, programId])

  React.useEffect(() => {
    const commitSha = program?.currentCommitSha
    if (!commitSha) return

    buildGenerationRef.current++
    restoredBuildCommitRef.current = null
    setBuildFiles([])
    setBuildArtifacts(new Map())
    setBuildArtifactsCommitSha(null)
    setBuildMessage('')
  }, [program?.currentCommitSha, programId])

  React.useEffect(() => {
    const commitSha = program?.currentCommitSha
    if (
      !commitSha ||
      isBuilding ||
      !cachedBuild ||
      cachedBuild.commitSha !== commitSha ||
      buildArtifactsCommitSha === commitSha ||
      restoredBuildCommitRef.current === commitSha
    ) {
      return
    }

    let isCurrent = true
    const generation = buildGenerationRef.current
    restoredBuildCommitRef.current = commitSha
    setBuildFiles(cachedBuild.binFiles)
    setBuildOutput(
      [cachedBuild.stdout, cachedBuild.stderr].filter(Boolean).join('\n'),
    )
    if (cachedBuild.exitCode !== 0) {
      setBuildArtifacts(new Map())
      setBuildArtifactsCommitSha(commitSha)
      setBuildMessage(`Build failed (exit code ${cachedBuild.exitCode})`)
      return
    }

    Promise.all(
      cachedBuild.artifacts.map(async ({ path, url }) => {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`Could not download ${path}`)
        return [path, new Uint8Array(await response.arrayBuffer())] as const
      }),
    )
      .then((artifacts) => {
        if (!isCurrent || generation !== buildGenerationRef.current) return
        setBuildArtifacts(new Map(artifacts))
        setBuildArtifactsCommitSha(commitSha)
        setBuildMessage(
          cachedBuild.binFiles.length > 0
            ? 'Build restored'
            : 'Build restored, no .bin files found',
        )
      })
      .catch((error: unknown) => {
        if (!isCurrent || generation !== buildGenerationRef.current) return
        setBuildArtifactsCommitSha(commitSha)
        setBuildMessage('Build succeeded, but artifacts could not be loaded')
        console.error('Could not restore VEX V5 build artifacts:', error)
      })

    return () => {
      isCurrent = false
    }
  }, [
    buildArtifactsCommitSha,
    cachedBuild,
    isBuilding,
    program?.currentCommitSha,
  ])

  const treePaths =
    paths === null ? null : [...new Set([...paths, ...buildFiles])]
  const firstFile = paths?.includes('src/main.cpp')
    ? 'src/main.cpp'
    : (paths?.[0] ?? buildFiles[0])
  const activeFile =
    selectedFile && treePaths?.includes(selectedFile) ? selectedFile : firstFile
  const buildButtonLabel = isBuilding
    ? `Building program, ${describeBuildElapsed(buildElapsedSeconds)} elapsed`
    : hasUnsavedChanges || isSaving
      ? 'Commit changes before building'
      : !program?.currentCommitSha || buildStatusIsPending
        ? 'Loading build status'
        : hasBuildForCurrentCommit
          ? 'Build already run for this commit'
          : buildMessage || 'Build program'
  const uploadUnavailableReason =
    hasUnsavedChanges || isSaving
      ? 'Commit changes before uploading.'
      : isBuilding
        ? 'Wait for the build to finish.'
        : buildArtifacts.size === 0 ||
            buildArtifactsCommitSha !== program?.currentCommitSha
          ? 'Build the program before uploading.'
          : ''

  return (
    <>
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
                paths={treePaths}
                selectedFile={activeFile}
                onSelect={(path) => {
                  if (isSaving || isUploading) return false
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
              disabled={isSaving || isUploading}
              onClick={() => {
                if (isSaving || isUploading) return
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
                size={isBuilding ? 'sm' : 'icon-sm'}
                variant="ghost"
                aria-label={buildButtonLabel}
                title={buildButtonLabel}
                onClick={() => void build()}
                disabled={
                  !program ||
                  !program.currentCommitSha ||
                  buildStatusIsPending ||
                  hasBuildForCurrentCommit ||
                  isBuilding ||
                  isSaving ||
                  hasUnsavedChanges ||
                  isUploading
                }
              >
                {isBuilding ? (
                  <>
                    <Spinner />
                    <span
                      aria-hidden="true"
                      className="font-mono text-xs tabular-nums"
                    >
                      {formatBuildElapsed(buildElapsedSeconds)}
                    </span>
                  </>
                ) : (
                  <HammerIcon />
                )}
              </Button>
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Upload to Brain"
                      title="Upload to Brain"
                    />
                  }
                >
                  <UploadSimpleIcon />
                </PopoverTrigger>
                <PopoverContent side="top" align="end" className="w-64">
                  <PopoverHeader>
                    <PopoverTitle className="text-base font-semibold">
                      Upload to Brain
                    </PopoverTitle>
                  </PopoverHeader>
                  <Separator />
                  <div className="grid gap-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Brain slot
                    </p>
                    <div
                      role="group"
                      aria-label="Brain slot"
                      className="grid grid-cols-4 gap-1.5"
                    >
                      {Array.from({ length: 8 }, (_, index) => index + 1).map(
                        (slot) => (
                          <Button
                            key={slot}
                            type="button"
                            size="sm"
                            variant={brainSlot === slot ? 'default' : 'outline'}
                            className="w-full"
                            aria-pressed={brainSlot === slot}
                            disabled={isUploading}
                            onClick={() => setBrainSlot(slot)}
                          >
                            {slot}
                          </Button>
                        ),
                      )}
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => void uploadToBrain()}
                      disabled={
                        !program ||
                        buildArtifacts.size === 0 ||
                        buildArtifactsCommitSha !== program.currentCommitSha ||
                        isBuilding ||
                        isSaving ||
                        isUploading ||
                        hasUnsavedChanges
                      }
                    >
                      {isUploading ? <Spinner /> : <UploadSimpleIcon />}
                      {isUploading ? 'Uploading to Brain' : 'Upload to Brain'}
                    </Button>
                    {isBrainConnected ? (
                      <Button
                        variant="outline"
                        className="w-full"
                        disabled={isUploading}
                        onClick={() => void disconnectBrain()}
                      >
                        Disconnect Brain
                      </Button>
                    ) : null}
                    {uploadMessage ? (
                      <p className="text-xs text-muted-foreground">
                        {uploadMessage}
                      </p>
                    ) : null}
                    {!uploadMessage && uploadUnavailableReason ? (
                      <p className="text-xs text-muted-foreground">
                        {uploadUnavailableReason}
                      </p>
                    ) : null}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <span className="sr-only" role="status" aria-live="polite">
              {[buildMessage, uploadMessage].filter(Boolean).join('. ')}
            </span>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="relative h-svh min-h-0 overflow-hidden">
          {loadError ? (
            <p className="p-4 text-sm text-muted-foreground">{loadError}</p>
          ) : programIsPending || paths === null ? (
            <div className="grid h-full place-items-center">
              <Spinner />
            </div>
          ) : !program ? (
            <p className="p-4 text-sm text-muted-foreground">
              Program not found.
            </p>
          ) : buildFiles.includes(activeFile) ? (
            <div className="p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Build artifact</p>
              <p className="mt-1">{activeFile}</p>
              <p className="mt-2">Temporary output; not committed to Git.</p>
            </div>
          ) : (
            <WorkspaceEditor
              key={programId}
              workspaceId={programId}
              template={program.template ?? 'vexcode'}
              commitSha={program.currentCommitSha}
              buildOutput={buildOutput}
              loadSnapshot={() => loadWorkspace({ programId })}
              commitChanges={(changes, expectedCommitSha, message) =>
                commitWorkspace({
                  programId,
                  changes,
                  expectedCommitSha,
                  message,
                })
              }
              onSelect={setSelectedFile}
              onPathsChange={setPaths}
              selectedFile={activeFile}
              onDirtyChange={setHasUnsavedChanges}
              onSavingChange={setIsSaving}
              saveHandlerRef={saveHandlerRef}
            />
          )}
        </SidebarInset>
      </SidebarProvider>
    </>
  )
}
