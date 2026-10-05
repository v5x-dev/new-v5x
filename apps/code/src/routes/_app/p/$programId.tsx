import { convexQuery } from '@convex-dev/react-query'
import {
  getFiletypeFromFileName,
  preloadHighlighter,
  type FileEditCompleteHandler,
  type FileOptions,
  type PostRenderPhase,
} from '@pierre/diffs'
import { Editor, type EditorFactory } from '@pierre/diffs/edit'
import { EditProvider, File } from '@pierre/diffs/react'
import { FileTree, useFileTree } from '@pierre/trees/react'
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
import type { CSSProperties } from 'react'
import {
  FileExitAction,
  ProgramIniConfig,
  V5SerialConnection,
  V5SerialDevice,
  type AdapterSerialPort,
} from '@v5x/serial'
import { createBrowserAdapter } from '@v5x/serial/browser'
import type { Id } from '../../../../convex/_generated/dataModel'
import { api } from '../../../../convex/_generated/api'
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
import { birdsOfParadiseTheme } from '~/lib/birds-of-paradise-theme'
import { parseProgramFilePaths } from '~/lib/program-files'

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

const bracketPairs = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
])
const closingBrackets = new Set(bracketPairs.values())

function getTextOffsetAtPosition(
  text: string,
  position: { line: number; character: number },
) {
  const lineBreaks = /\r\n|\r|\n/g
  let offset = 0

  for (let line = 0; line < position.line; line++) {
    const lineBreak = lineBreaks.exec(text)
    if (!lineBreak) return text.length
    offset = lineBreak.index + lineBreak[0].length
    lineBreaks.lastIndex = offset
  }

  return Math.min(offset + position.character, text.length)
}

function getPositionAtTextOffset(text: string, offset: number) {
  const lines = text.slice(0, offset).split(/\r\n|\r|\n/)
  return {
    line: lines.length - 1,
    character: lines.at(-1)?.length ?? 0,
  }
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
  const [paths, setPaths] = React.useState<string[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null)
  const [buildFiles, setBuildFiles] = React.useState<string[]>([])
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
            getPorts: async () => [port],
            requestPort: async () => port,
          },
          { autoRefresh: false },
        )
        const serialConnection = new V5SerialConnection({
          getPorts: async () => [port],
          requestPort: async () => port,
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
    : (paths?.[0] ?? buildFiles[0] ?? '')
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
                  if (isSaving || isUploading) return false
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
              disabled={isSaving || isUploading}
              onClick={() => {
                if (isSaving || isUploading) return
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

        <SidebarInset className="h-svh min-h-0 overflow-auto">
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
  const editorRef = React.useRef<Editor<'file'> | null>(null)
  const bracketInputListenerRef = React.useRef<{
    host: HTMLElement
    target: HTMLElement
    listener: (event: InputEvent) => void
  } | null>(null)
  const [source, setSource] = React.useState<string | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [readyFile, setReadyFile] = React.useState<string | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const savedContentsRef = React.useRef<string | null>(null)
  const draftRef = React.useRef('')
  const currentFileRef = React.useRef(selectedFile)
  const isSavingRef = React.useRef(false)

  const handleBracketInput = React.useCallback((event: InputEvent) => {
    const editor = editorRef.current
    const input = event.data
    if (
      !editor ||
      event.isComposing ||
      event.inputType !== 'insertText' ||
      !input ||
      (bracketPairs.get(input) === undefined && !closingBrackets.has(input))
    ) {
      return
    }

    const text = editor.getText()
    const selections = editor.getViewState().selections ?? []
    if (selections.length === 0) return

    const selectionOffsets = selections.map((selection) => {
      const start = getTextOffsetAtPosition(text, selection.start)
      const end = getTextOffsetAtPosition(text, selection.end)
      return start === end ? start : null
    })
    if (selectionOffsets.some((offset) => offset === null)) return

    const offsets = selectionOffsets as number[]
    const uniqueOffsets = [...new Set(offsets)].sort(
      (left, right) => left - right,
    )
    let replacements: Array<{ offset: number; text: string }>

    if (bracketPairs.has(input)) {
      const closing = bracketPairs.get(input)
      replacements = uniqueOffsets.map((offset) => ({
        offset,
        text: text[offset] === closing ? input : input + closing,
      }))
    } else {
      if (!uniqueOffsets.some((offset) => text[offset] === input)) return
      replacements = uniqueOffsets
        .filter((offset) => text[offset] !== input)
        .map((offset) => ({ offset, text: input }))
    }

    event.preventDefault()
    event.stopImmediatePropagation()

    if (replacements.length > 0) {
      editor.applyEdits(
        replacements.map(({ offset, text: replacement }) => {
          const position = getPositionAtTextOffset(text, offset)
          return {
            range: { start: position, end: position },
            newText: replacement,
          }
        }),
      )
    }

    const updatedText = editor.getText()
    editor.setSelections(
      offsets.map((offset) => {
        const insertedBefore = replacements
          .filter((replacement) => replacement.offset < offset)
          .reduce((length, replacement) => length + replacement.text.length, 0)
        const position = getPositionAtTextOffset(
          updatedText,
          offset + insertedBefore + 1,
        )
        return { start: position, end: position, direction: 'none' }
      }),
    )
  }, [])

  const onFilePostRender = React.useCallback<
    NonNullable<FileOptions<undefined, undefined>['onPostRender']>
  >(
    (node, _instance, phase: PostRenderPhase) => {
      const attached = bracketInputListenerRef.current
      if (phase === 'unmount') {
        if (attached?.host === node) {
          attached.target.removeEventListener(
            'beforeinput',
            attached.listener,
            true,
          )
          bracketInputListenerRef.current = null
          editorRef.current = null
        }
        return
      }

      const target =
        node.shadowRoot?.querySelector<HTMLElement>('[data-content]')
      if (!target || (attached?.host === node && attached.target === target)) {
        return
      }

      attached?.target.removeEventListener(
        'beforeinput',
        attached.listener,
        true,
      )
      target.addEventListener('beforeinput', handleBracketInput, true)
      bracketInputListenerRef.current = {
        host: node,
        target,
        listener: handleBracketInput,
      }
    },
    [handleBracketInput],
  )

  const editorOptions = React.useMemo(
    () => ({
      matchBrackets: true,
      onAttach: (editor: Editor<'file'>) => {
        editorRef.current = editor
      },
    }),
    [],
  )
  const fileOptions = React.useMemo(
    () => ({ ...programFileOptions, onPostRender: onFilePostRender }),
    [onFilePostRender],
  )

  React.useEffect(
    () => () => {
      const attached = bracketInputListenerRef.current
      attached?.target.removeEventListener(
        'beforeinput',
        attached.listener,
        true,
      )
      bracketInputListenerRef.current = null
      editorRef.current = null
    },
    [],
  )

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
        editorOptions={editorOptions}
        onEditChange={handleEditChange}
        onEditComplete={rejectUncommittedEdit}
        options={fileOptions}
        className="block min-h-0 flex-1"
        style={programFileStyle}
      />
    </div>
  )
}
