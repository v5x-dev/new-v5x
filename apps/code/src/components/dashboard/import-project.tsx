import { useAction } from 'convex/react'
import { CaretUpDownIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { Button } from '@v5x/ui/components/button'
import { Input } from '@v5x/ui/components/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@v5x/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@v5x/ui/components/dropdown-menu'
import { importDraftRecovery } from '~/lib/draft-recovery'
import { importSourceZip } from '~/lib/source-zip'
import type { SourceFile } from '~/lib/source-files'
import { templateInfo, templates, type Template } from './templates'

export function ImportProject({ disabled = false }: { disabled?: boolean }) {
  const importSources = useAction(api.program.importSources)
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('Imported project')
  const [template, setTemplate] = useState<Template>('vexcode')
  const [files, setFiles] = useState<SourceFile[]>([])
  const [stripRoot, setStripRoot] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const root = files[0]?.path.split('/')[0]
  const enclosingRoot =
    root && files.every((file) => file.path.startsWith(`${root}/`))
      ? root
      : null

  async function readFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    setFiles([])
    setStripRoot(false)
    try {
      if (file.size > 16 * 1024 * 1024)
        throw new Error('Import file exceeds the 16 MiB limit')
      setFiles(
        /\.json$/i.test(file.name)
          ? importDraftRecovery(await file.text())
          : importSourceZip(new Uint8Array(await file.arrayBuffer())),
      )
      setName(
        file.name.replace(/\.(zip|json)$/i, '').slice(0, 120) ||
          'Imported project',
      )
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Unable to read source file.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !files.length) return
    setBusy(true)
    setError('')
    try {
      await importSources({
        name,
        template,
        files:
          stripRoot && enclosingRoot
            ? files.map((file) => ({
                ...file,
                path: file.path.slice(enclosingRoot.length + 1),
              }))
            : files,
      })
      setOpen(false)
      setFiles([])
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to import project.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value)
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className="group flex w-full flex-col gap-2 text-left active:scale-[0.98]"
          />
        }
      >
        <span className="grid h-32 place-items-center rounded-lg border bg-muted/50 transition-colors group-hover:bg-muted">
          <UploadSimpleIcon
            aria-hidden="true"
            className="size-12 text-muted-foreground"
          />
        </span>
        <span className="text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground">
          Import
        </span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>
            Choose a source ZIP or a downloaded draft recovery JSON.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-4"
        >
          <fieldset disabled={busy} className="flex flex-col gap-3">
            <Button
              variant="outline"
              type="button"
              onClick={() => input.current?.click()}
            >
              Choose ZIP or recovery JSON
            </Button>
            <input
              hidden
              ref={input}
              type="file"
              accept=".zip,.json,application/zip,application/json"
              aria-label="Project source file"
              onChange={(event) => void readFile(event)}
            />
            <label className="flex flex-col gap-1">
              Project name
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                required
              />
            </label>
            <label className="flex flex-col gap-1">
              SDK template
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      className="w-full justify-start"
                      variant="outline"
                      type="button"
                      disabled={busy}
                      aria-label={`SDK template: ${templateInfo[template].label}`}
                    />
                  }
                >
                  <CaretUpDownIcon
                    aria-hidden="true"
                    data-icon="inline-start"
                  />
                  {templateInfo[template].label}
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuRadioGroup
                    value={template}
                    onValueChange={(value) => {
                      if (templates.includes(value as Template))
                        setTemplate(value as Template)
                    }}
                  >
                    {templates.map((value) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {templateInfo[value].label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </label>
            {files.length > 0 && (
              <p role="status">{files.length} source files selected</p>
            )}
            {enclosingRoot && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={stripRoot}
                  onChange={(event) => setStripRoot(event.target.checked)}
                />
                Remove enclosing folder “{enclosingRoot}”
              </label>
            )}
            {files.length > 0 && (
              <ul className="max-h-32 overflow-auto text-sm text-muted-foreground">
                {files.slice(0, 20).map((file) => (
                  <li key={file.path}>
                    {stripRoot && enclosingRoot
                      ? file.path.slice(enclosingRoot.length + 1)
                      : file.path}
                  </li>
                ))}
                {files.length > 20 && <li>…and {files.length - 20} more</li>}
              </ul>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter className="flex-row justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !files.length || !name.trim()}
            >
              {busy ? 'Importing...' : 'Import'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
