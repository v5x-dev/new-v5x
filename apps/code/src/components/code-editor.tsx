import { convexAction } from '@convex-dev/react-query'
import { registerCustomTheme } from '@pierre/diffs'
import {
  EditProvider,
  File,
  type EditorFactory,
  type FileEditChangeHandler,
} from '@pierre/diffs/react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { Editor } from '@pierre/diffs/edit'
import { birdsOfParadiseTheme } from '~/lib/themes/birds-of-paradise'
import { useAction } from 'convex/react'
import { useCallback, useEffect, useRef } from 'react'

registerCustomTheme('birds-of-paradise', async () => birdsOfParadiseTheme)

const createEditor: EditorFactory<undefined, undefined> = (
  editorType,
  options,
  editStateKey,
) => new Editor(editorType, options, editStateKey)

export function CodeEditor({
  programId,
  selectedPath,
  headSha,
  onDirtyChange,
}: {
  programId: Id<'program'>
  selectedPath: string
  headSha: string
  onDirtyChange: (path: string, isDirty: boolean) => void
}) {
  const { data: contents } = useQuery(
    convexAction(api.program.readFile, {
      programId,
      path: selectedPath,
      headSha,
    }),
  )
  const saveFile = useAction(api.program.saveFile)
  const headShaRef = useRef(headSha)
  const pendingSavesRef = useRef(new Map<string, string>())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSavingRef = useRef(false)

  useEffect(() => {
    if (!isSavingRef.current) {
      headShaRef.current = headSha
    }
  }, [headSha])

  const flushSaves = useCallback(async () => {
    if (isSavingRef.current || pendingSavesRef.current.size === 0) {
      return
    }

    isSavingRef.current = true

    let failed = false

    for (const [path, contents] of pendingSavesRef.current) {
      const isCurrentSave = pendingSavesRef.current.get(path) === contents

      if (isCurrentSave) {
        pendingSavesRef.current.delete(path)
      }

      try {
        const result = await saveFile({
          programId,
          path,
          contents,
          headSha: headShaRef.current,
        })
        headShaRef.current = result.headSha

        if (!pendingSavesRef.current.has(path)) {
          onDirtyChange(path, false)
        }
      } catch {
        if (!pendingSavesRef.current.has(path)) {
          pendingSavesRef.current.set(path, contents)
        }
        failed = true
        onDirtyChange(path, true)
        break
      }
    }

    isSavingRef.current = false

    if (failed) {
      return
    }

    if (pendingSavesRef.current.size > 0) {
      void flushSaves()
    }
  }, [onDirtyChange, programId, saveFile])

  const scheduleSave = useCallback(
    (path: string, nextContents: string) => {
      pendingSavesRef.current.set(path, nextContents)
      onDirtyChange(path, true)

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }

      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        void flushSaves()
      }, 750)
    },
    [flushSaves, onDirtyChange],
  )

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
      void flushSaves()
    }
  }, [flushSaves])

  const handleChange: FileEditChangeHandler<undefined, undefined> = (event) => {
    scheduleSave(event.file.name, event.file.contents)
  }

  return (
    <EditProvider createEditor={createEditor}>
      {contents !== undefined && (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1 overflow-auto [--diffs-font-family:var(--font-mono)]">
            <File
              disableWorkerPool
              edit
              editStateKey={selectedPath}
              onEditChange={handleChange}
              file={{ name: selectedPath, contents }}
              options={{
                disableFileHeader: true,
                theme: {
                  dark: 'birds-of-paradise',
                  light: 'birds-of-paradise',
                },
              }}
            />
          </div>
        </div>
      )}
    </EditProvider>
  )
}
