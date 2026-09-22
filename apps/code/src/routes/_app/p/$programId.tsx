import { convexAction, convexQuery } from '@convex-dev/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from '~/components/ui/sidebar'
import { api } from '../../../../convex/_generated/api'
import { ProgramTree } from '~/components/program-tree'
import { useQuery } from '@tanstack/react-query'
import type { Id } from '../../../../convex/_generated/dataModel'
import { useState } from 'react'
import { CodeEditor } from '~/components/code-editor'
import { Button } from '~/components/ui/button'
import { ArrowLeftIcon, HammerIcon } from '@phosphor-icons/react'
import { useAction } from 'convex/react'
import { useCallback, useEffect } from 'react'

export const Route = createFileRoute('/_app/p/$programId')({
  beforeLoad: async ({ context, params }) => {
    const programs = await context.queryClient.query({
      ...convexQuery(api.program.list),
      staleTime: 'static',
    })

    if (!programs.some((program) => program._id === params.programId)) {
      throw redirect({ to: '/' })
    }
  },
  component: RouteComponent,
})

function RouteComponent() {
  const { programId } = Route.useParams()
  const programIdValue = programId as Id<'program'>

  const [selectedPath, selectPath] = useState('src/main.cpp')
  const [unsavedPaths, setUnsavedPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  const handleDirtyChange = useCallback((path: string, isDirty: boolean) => {
    setUnsavedPaths((previous) => {
      if (isDirty) {
        if (previous.has(path)) return previous

        return new Set(previous).add(path)
      }

      if (!previous.has(path)) return previous

      const next = new Set(previous)
      next.delete(path)
      return next
    })
  }, [])

  useEffect(() => {
    setUnsavedPaths(new Set())
  }, [programId])

  const buildProgram = useAction(api.program.build)

  const { data: programs } = useQuery(convexQuery(api.program.list))
  const { data: session } = useQuery(
    convexQuery(api.program.getSession, { programId: programIdValue }),
  )

  const { data: ensuredSession } = useQuery({
    ...convexAction(api.program.ensureSession, {
      programId: programIdValue,
    }),
    staleTime: 'static',
  })

  const activeSession = session ?? ensuredSession
  const { data: programFiles } = useQuery(
    convexAction(
      api.program.listFiles,
      activeSession
        ? { programId: programIdValue, headSha: activeSession.headSha }
        : 'skip',
    ),
  )

  const program = programs?.find((p) => p._id === programId)

  return (
    <SidebarProvider>
      <Sidebar variant="floating">
        {program && (
          <>
            <SidebarHeader className="text-xs text-muted-foreground p-4 pb-2">
              {program.name}
            </SidebarHeader>

            <SidebarContent>
              {programFiles && (
                <ProgramTree
                  paths={programFiles.paths}
                  onFileSelect={selectPath}
                  unsavedPaths={unsavedPaths}
                />
              )}
            </SidebarContent>
          </>
        )}

        <SidebarFooter className="flex flex-row justify-between items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link to="/" />}
            nativeButton={false}
          >
            <ArrowLeftIcon />
          </Button>

          <div className="flex flex-row gap-1 items-center">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!activeSession}
              onClick={() => {
                if (!activeSession) return

                void buildProgram({
                  programId: programIdValue,
                  headSha: activeSession?.headSha,
                })
              }}
            >
              <HammerIcon />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="max-h-screen overflow-hidden">
        {program && activeSession && (
          <CodeEditor
            programId={program._id}
            selectedPath={selectedPath}
            headSha={activeSession.headSha}
            onDirtyChange={handleDirtyChange}
          />
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
