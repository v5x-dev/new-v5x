import * as React from 'react'
import {
  buildInBrowser,
  readBrowserBuild,
  releaseBrowserCompiler,
  scheduleBrowserCompilerPreload,
  writeBrowserBuild,
  type BrowserBuildResult,
  type ProjectTemplate,
} from '@v5x/compiler'
import { buildOnServer } from '@v5x/compiler/remote-build'
import type { ProjectSnapshot } from '~/lib/ide/workspace'

const MAX_OUTPUT_LENGTH = 400 * 1024
const BUILD_CACHE_DELAY = 4_000

export interface BuildArtifacts {
  commitSha: string
  byPath: ReadonlyMap<string, Uint8Array>
}

interface Options {
  programId: string
  template: ProjectTemplate
  currentCommitSha: string | undefined
  // Empty when building in the browser.
  compilationServer: string
  compilationServerLoaded: boolean
  // Save live documents first, then read the committed snapshot to build.
  save: () => Promise<void>
  snapshot: () => ProjectSnapshot | undefined
  onStart?: () => void
}

const artifactsFrom = (result: BrowserBuildResult): BuildArtifacts => ({
  commitSha: result.commitSha,
  byPath: new Map(result.artifacts.map(({ path, bytes }) => [path, bytes])),
})

// Builds the current commit in the browser or on a compilation server, keeps
// the artifacts for that commit and restores cached artifacts on reload.
export function useProgramBuild(options: Options) {
  const {
    programId,
    template,
    currentCommitSha,
    compilationServer,
    compilationServerLoaded,
  } = options

  const optionsRef = React.useRef(options)
  optionsRef.current = options

  const [artifacts, setArtifacts] = React.useState<BuildArtifacts | null>(null)
  const [isBuilding, setIsBuilding] = React.useState(false)
  const [startedAt, setStartedAt] = React.useState<number | null>(null)
  const [message, setMessage] = React.useState('')
  const [output, setOutput] = React.useState('')
  const [firstBrowserBuild, setFirstBrowserBuild] = React.useState(true)
  const elapsedSeconds = useElapsedSeconds(isBuilding ? startedAt : null)

  const lockRef = React.useRef(false)
  const generationRef = React.useRef(0)
  const abortRef = React.useRef<AbortController | null>(null)
  const attemptedRef = React.useRef('')
  const commitShaRef = React.useRef(currentCommitSha)
  const pendingCacheRef = React.useRef<BrowserBuildResult | null>(null)

  React.useEffect(() => {
    commitShaRef.current = currentCommitSha
  }, [currentCommitSha])

  const flushCache = React.useCallback(() => {
    const pending = pendingCacheRef.current
    if (!pending) return
    pendingCacheRef.current = null
    void writeBrowserBuild(programId, pending).catch((error) =>
      console.error('Could not cache browser build:', error),
    )
  }, [programId])

  React.useEffect(() => {
    const onHide = () => flushCache()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      flushCache()
    }
  }, [flushCache])

  React.useEffect(
    () => () => {
      abortRef.current?.abort()
      releaseBrowserCompiler()
    },
    [],
  )

  const build = async () => {
    if (lockRef.current) return
    lockRef.current = true

    try {
      // The save handler reads live documents, including edits whose dirty
      // notification has not rendered yet when a shortcut fires.
      await optionsRef.current.save()
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not save changes.',
      )
      lockRef.current = false
      return
    }

    const started = performance.now()
    const snapshot = optionsRef.current.snapshot()
    if (!snapshot?.commitSha) {
      lockRef.current = false
      return
    }

    commitShaRef.current = snapshot.commitSha
    attemptedRef.current = `${programId}:${snapshot.commitSha}`
    const controller = new AbortController()
    abortRef.current = controller
    const generation = ++generationRef.current
    const isCurrent = () => generation === generationRef.current

    setStartedAt(started)
    setIsBuilding(true)
    setMessage(
      compilationServer
        ? 'Building remotely'
        : 'Building in browser. The first build downloads the compiler once.',
    )
    optionsRef.current.onStart?.()
    setArtifacts(null)
    setOutput('')

    try {
      const compile = compilationServer
        ? buildOnServer.bind(null, compilationServer)
        : buildInBrowser

      const result = await compile(
        { ...snapshot, workspaceId: programId, template },
        (text) => {
          if (isCurrent())
            setOutput((current) => (current + text).slice(-MAX_OUTPUT_LENGTH))
        },
        controller.signal,
      )

      if (!isCurrent() || result.commitSha !== commitShaRef.current) return

      setOutput(result.output.slice(-MAX_OUTPUT_LENGTH))
      setArtifacts(artifactsFrom(result))
      setMessage(
        result.exitCode === 0
          ? `Build succeeded · ${Math.round((performance.now() - started) / 1000)}s`
          : `Build failed (exit code ${result.exitCode})`,
      )
      // Keep the upload buffers in React. Cache them after idle so IndexedDB's
      // structured clone does not stack on the live artifacts at peak.
      pendingCacheRef.current = result
      setTimeout(flushCache, BUILD_CACHE_DELAY)
    } catch (error) {
      if (!isCurrent()) return
      const reason = error instanceof Error ? error.message : String(error)
      setMessage(controller.signal.aborted ? 'Build cancelled' : 'Build failed')
      setOutput((current) => `${current}\n${reason}`)
      if (!controller.signal.aborted)
        console.error('Browser build failed:', error)
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setStartedAt(null)
        setIsBuilding(false)
        if (!compilationServer) setFirstBrowserBuild(false)
        lockRef.current = false
      }
      console.info(
        `Browser build finished in ${Math.round(performance.now() - started)} ms`,
      )
    }
  }

  const cancel = () => abortRef.current?.abort()

  // A commit records its SHA before the program query catches up.
  const noteCommit = (commitSha: string) => {
    commitShaRef.current = commitSha
  }

  React.useEffect(() => {
    if (!currentCommitSha || !compilationServerLoaded || compilationServer)
      return

    return scheduleBrowserCompilerPreload({
      workspaceId: programId,
      template,
      commitSha: currentCommitSha,
      files: {},
    })
  }, [
    programId,
    template,
    currentCommitSha,
    compilationServer,
    compilationServerLoaded,
  ])

  // Drop artifacts from an older commit, unless this commit's build is the
  // one in progress.
  React.useEffect(() => {
    if (
      !currentCommitSha ||
      lockRef.current ||
      attemptedRef.current === `${programId}:${currentCommitSha}`
    )
      return

    generationRef.current++
    attemptedRef.current = ''
    setArtifacts(null)
    setMessage('')
  }, [currentCommitSha, programId])

  React.useEffect(() => {
    if (
      !currentCommitSha ||
      isBuilding ||
      artifacts?.commitSha === currentCommitSha ||
      attemptedRef.current === `${programId}:${currentCommitSha}`
    )
      return

    let active = true
    const generation = generationRef.current

    void readBrowserBuild(programId)
      .then((cached) => {
        if (
          !active ||
          generation !== generationRef.current ||
          cached?.commitSha !== currentCommitSha
        )
          return

        setOutput(cached.output)
        setArtifacts(artifactsFrom(cached))
        setMessage(
          cached.exitCode === 0
            ? 'Build restored'
            : `Build failed (exit code ${cached.exitCode})`,
        )
      })
      .catch((error) =>
        console.error('Could not restore browser build:', error),
      )

    return () => {
      active = false
    }
  }, [isBuilding, artifacts?.commitSha, currentCommitSha, programId])

  return {
    artifacts,
    isBuilding,
    elapsedSeconds,
    message,
    output,
    firstBrowserBuild,
    build,
    cancel,
    noteCommit,
  }
}

function useElapsedSeconds(startedAt: number | null) {
  const [seconds, setSeconds] = React.useState(1)

  React.useEffect(() => {
    setSeconds(1)
    if (startedAt === null) return

    const interval = window.setInterval(() => {
      setSeconds(Math.floor((performance.now() - startedAt) / 1000) + 1)
    }, 1000)
    return () => window.clearInterval(interval)
  }, [startedAt])

  return seconds
}
