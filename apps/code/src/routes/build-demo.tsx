import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { templateFiles } from '../../convex/template'
import type { Diagnostic } from 'vscode-languageserver-protocol'
import type { ProgramTemplate } from '../../convex/template'
import type { BrowserBuildResult } from '~/lib/ide/browser-build'
import { Button } from '~/components/ui/button'
import { PierreDocument } from '~/components/ide/pierre-document'
import { buildInBrowser, releaseBrowserCompiler } from '~/lib/ide/build-client'

export const Route = createFileRoute('/build-demo')({
  head: () => ({ meta: [{ title: 'Browser build | v5x' }] }),
  component: BuildDemo,
})

const templates: Array<{ id: ProgramTemplate; label: string }> = [
  { id: 'vexcode', label: 'VEXcode' },
  { id: 'pros', label: 'PROS' },
  { id: 'ez-template', label: 'EZ Template' },
  { id: 'jar-template', label: 'JAR Template' },
]
const ignore = () => {}
const diagnostics: Array<Diagnostic> = []

function download(artifact: BrowserBuildResult['artifacts'][number]) {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(artifact.bytes)], {
      type: 'application/octet-stream',
    }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = artifact.path.split('/').at(-1) ?? 'program.bin'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function BuildDemo() {
  const [template, setTemplate] = useState<ProgramTemplate>('ez-template')
  const [files, setFiles] = useState(() => ({
    ...templateFiles['ez-template'],
  }))
  const [path, setPath] = useState('src/main.cpp')
  const [revision, setRevision] = useState(0)
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState('Ready')
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [result, setResult] = useState<BrowserBuildResult | null>(null)
  const controller = useRef<AbortController | null>(null)
  const log = useRef<HTMLPreElement>(null)

  useEffect(
    () => () => {
      controller.current?.abort()
      releaseBrowserCompiler()
    },
    [],
  )

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight
  }, [output])

  function reset(next: ProgramTemplate) {
    setTemplate(next)
    setFiles({ ...templateFiles[next] })
    setPath('src/main.cpp')
    setRevision((value) => value + 1)
    setResult(null)
    setOutput('')
    setElapsed(null)
    setStatus('Ready')
  }

  async function build() {
    if (controller.current) return
    const abort = new AbortController()
    controller.current = abort
    setRunning(true)
    setResult(null)
    setOutput('')
    setStatus('Building')
    setElapsed(0)
    const start = performance.now()
    const timer = setInterval(
      () => setElapsed((performance.now() - start) / 1000),
      100,
    )
    try {
      const built = await buildInBrowser(
        {
          workspaceId: `build-demo:${template}`,
          files: { ...files },
          template,
          commitSha: `demo-${Date.now()}`,
        },
        (text) => setOutput((previous) => (previous + text).slice(-400_000)),
        abort.signal,
      )
      setResult(built)
      setStatus(built.exitCode === 0 ? 'Build succeeded' : 'Build failed')
    } catch (error) {
      const message = abort.signal.aborted
        ? 'Build cancelled'
        : error instanceof Error
          ? error.message
          : String(error)
      setStatus(abort.signal.aborted ? 'Build cancelled' : 'Build failed')
      setOutput((previous) => `${previous}\n${message}\n`)
    } finally {
      clearInterval(timer)
      setElapsed((performance.now() - start) / 1000)
      controller.current = null
      setRunning(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-6 p-4 md:p-8">
      <header>
        <p className="mb-2 text-xs uppercase tracking-widest text-primary">
          v5x / compiler demo
        </p>
        <h1 className="text-3xl font-semibold">Browser build</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Edit a robot program and compile it with Clang and LLD running in
          WebAssembly. Source stays in your browser. The first build downloads
          the compiler and SDK; subsequent builds reuse cached files.
        </p>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Template
          <select
            aria-label="Template"
            disabled={running}
            value={template}
            onChange={(event) => reset(event.target.value as ProgramTemplate)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <Button size="lg" disabled={running} onClick={() => void build()}>
          Build in browser
        </Button>
        {running && (
          <Button
            size="lg"
            variant="outline"
            onClick={() => controller.current?.abort()}
          >
            Cancel build
          </Button>
        )}
        <Button
          size="lg"
          variant="ghost"
          disabled={running}
          onClick={() => reset(template)}
        >
          Reset source
        </Button>
        <p role="status" className="pb-2 text-sm">
          {status}
          {elapsed !== null && ` · ${elapsed.toFixed(1)} s`}
        </p>
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <section
          aria-label="Source editor"
          className="min-w-0 overflow-hidden rounded-lg border border-border"
        >
          <div className="flex items-center gap-3 border-b border-border p-3">
            <label htmlFor="demo-file" className="text-sm">
              Source
            </label>
            <select
              id="demo-file"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              className="min-w-0 flex-1 rounded border border-input bg-background p-1 text-xs"
            >
              {Object.keys(files)
                .sort()
                .map((file) => (
                  <option key={file} value={file}>
                    {file}
                  </option>
                ))}
            </select>
          </div>
          <div className="h-[500px] overflow-auto">
            <PierreDocument
              path={path}
              contents={files[path] ?? ''}
              sessionKey={`demo-${template}-${revision}-${path}`}
              diagnostics={diagnostics}
              readOnly={running}
              onChange={(contents) => {
                setFiles((previous) => ({ ...previous, [path]: contents }))
                setResult(null)
                setStatus('Source changed')
              }}
              onEditor={ignore}
              onPosition={ignore}
              onCommand={ignore}
            />
          </div>
        </section>
        <section
          aria-label="Build output"
          className="min-w-0 overflow-hidden rounded-lg border border-border"
        >
          <h2 className="border-b border-border p-3 text-sm">
            Compiler output
          </h2>
          <pre
            ref={log}
            data-testid="build-output"
            className="h-[500px] overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-5"
          >
            {output || 'Choose a template and press Build in browser.'}
          </pre>
        </section>
      </div>
      {result?.exitCode === 0 && (
        <section
          aria-label="Build artifacts"
          className="flex flex-wrap items-center gap-3"
        >
          <h2 className="text-sm">Binaries</h2>
          {result.artifacts.map((artifact) => (
            <Button
              key={artifact.path}
              variant="outline"
              onClick={() => download(artifact)}
            >
              Download {artifact.path.split('/').at(-1)} ·{' '}
              {(artifact.bytes.byteLength / 1024).toFixed(1)} KB
            </Button>
          ))}
        </section>
      )}
      <p className="text-xs text-muted-foreground">
        PROS and EZ Template produce separate hot and cold binaries. This demo
        uses the same compiler as the project workspace. Edits last until you
        reset or leave this page.
      </p>
    </main>
  )
}
