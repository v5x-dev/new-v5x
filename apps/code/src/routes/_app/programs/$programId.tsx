import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { BIRDS_OF_PARADISE_THEME } from "@/lib/birds-of-paradise"
import { convexQuery } from "@convex-dev/react-query"
import { ArrowLeftIcon } from "@phosphor-icons/react"
import type { CodeViewItem } from "@pierre/diffs"
import { Editor } from "@pierre/diffs/edit"
import { CodeView, EditProvider } from "@pierre/diffs/react"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import type React from "react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"

export const Route = createFileRoute("/_app/programs/$programId")({
  component: RouteComponent,
})

type ProgramFile = {
  path: string
  name: string
  content: string
  isReadonly: boolean
}

type ProgramData = {
  program: {
    _id: Id<"programs">
    title: string
    framework: "vexcode" | "pros" | "ez"
  }
  files: ProgramFile[]
}

const PROGRAM_FILE_TREE_ICON_SPRITE = `
  <svg aria-hidden="true" width="0" height="0">
    <symbol id="vscode-seti-makefile" viewBox="0 0 32 32">
      <path fill="#e37933" d="M10.2 7 7 7.8v16h4.2v-9.9l3.6 3.9h2.4l3.6-3.9v9.9H25v-16L21.8 7 16 13.3 10.2 7z" />
    </symbol>
    <symbol id="v5x-pros" viewBox="4 4 105 105">
      <g fill="#E6B85C">
        <path d="M84.4 46 99.6 59.1 55.5 97.6V97.5L55.4 97.6 11.5 59.3 26.7 46.1 55.5 88.3Z" />
        <path d="M33.5 32.8 34.4 34.3H76.6L77.5 32.8Z" />
        <path d="M43.5 61.1 38.5 46.6 24.3 38.7Z" />
        <path d="M67.5 61.3 72.7 46.6 86.6 38.8Z" />
        <path d="M55.5 13.2 18.1 30.1h13.4l2.8 4.3h42.2l2.8-4.3h13.4L55.5 13.2zM58.4 23.5l-2.9 1.5-2.9-1.5v-2.9l2.9-1.5 2.9 1.5V23.5z" />
        <path d="M85.9 38.7H25.1l.1.1 18.5 2.8L43.5 61.1l-2.4-2.8 13.7 16.8V56.9c0-.3.3-.6.6-.6h.3c.3 0 .6.3.6.6v18.3l11.4-14-.1.1L67.2 41.6l18.4-2.6L85.9 38.7zM55.5 53.4c-.6 0-1.2-.5-1.2-1.2s.5-1.2 1.2-1.2c.6 0 1.2.5 1.2 1.2S56.1 53.4 55.5 53.4zM55.5 48.4c-.6 0-1.2-.5-1.2-1.2s.5-1.2 1.2-1.2c.6 0 1.2.5 1.2 1.2S56.1 48.4 55.5 48.4zM55.5 43.2c-.6 0-1.2-.5-1.2-1.2s.5-1.2 1.2-1.2c.6 0 1.2.5 1.2 1.2S56.1 43.2 55.5 43.2z" />
      </g>
    </symbol>
  </svg>
`

const PROGRAM_FILE_TREE_ICONS = {
  set: "complete",
  colored: true,
  spriteSheet: PROGRAM_FILE_TREE_ICON_SPRITE,
  byFileName: {
    Makefile: {
      name: "vscode-seti-makefile",
      width: 20,
      height: 20,
      viewBox: "0 0 32 32",
    },
    "project.pros": {
      name: "v5x-pros",
      width: 18,
      height: 18,
      viewBox: "4 4 105 105",
    },
  },
} as const

function ProgramFileTree({
  files,
  initialPath,
  onFileSelect,
}: {
  files: ProgramFile[]
  initialPath: string
  onFileSelect: (path: string) => void
}) {
  const filePaths = useMemo(
    () => new Set(files.map((file) => file.path)),
    [files]
  )
  const { model } = useFileTree({
    flattenEmptyDirectories: false,
    icons: PROGRAM_FILE_TREE_ICONS,
    initialExpansion: "open",
    initialSelectedPaths: [initialPath],
    onSelectionChange: (selectedPaths) => {
      const selectedFile = [...selectedPaths]
        .reverse()
        .find((path) => filePaths.has(path))

      if (selectedFile) {
        onFileSelect(selectedFile)
      }
    },
    paths: files.map((file) => file.path),
    search: false,
  })

  return (
    <FileTree
      model={model}
      aria-label="Program files"
      className="min-h-0 flex-1"
      style={
        {
          height: "100%",
          "--trees-bg-override": "var(--sidebar)",
          "--trees-bg-muted-override": "var(--sidebar-accent)",
          "--trees-border-color-override": "var(--sidebar-border)",
          "--trees-fg-override": "var(--sidebar-foreground)",
          "--trees-fg-muted-override": "var(--muted-foreground)",
          "--trees-font-family-override": "var(--font-mono)",
          "--trees-font-size-override": "0.8125rem",
          "--trees-padding-inline-override": "0.5rem",
          "--trees-selected-bg-override": "var(--sidebar-accent)",
          "--trees-selected-fg-override": "var(--sidebar-accent-foreground)",
        } as React.CSSProperties
      }
    />
  )
}

function RouteComponent() {
  const { programId } = Route.useParams()
  const { data } = useSuspenseQuery(
    convexQuery(api.programs.get, {
      programId: programId as Id<"programs">,
    })
  )

  if (!data) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-foreground">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Program not found</h1>
          <Link
            to="/programs"
            className="mt-3 inline-block text-sm text-muted-foreground underline underline-offset-4"
          >
            Back to programs
          </Link>
        </div>
      </main>
    )
  }

  return <ProgramEditor key={data.program._id} data={data} />
}

function ProgramEditor({ data }: { data: ProgramData }) {
  const defaultPath =
    data.files.find((file) => file.path === "src/main.cpp")?.path ??
    data.files[0]?.path
  const [activePath, setActivePath] = useState(defaultPath)
  const activeFile =
    data.files.find((file) => file.path === activePath) ?? data.files[0]

  const codeItems: CodeViewItem<undefined>[] = [
    {
      id: `file:${activeFile.path}`,
      type: "file",
      file: {
        name: activeFile.path,
        contents: activeFile.content,
      },
      edit: !activeFile.isReadonly,
    },
  ]

  return (
    <SidebarProvider
      className="h-screen min-h-0 overflow-hidden"
      style={{ "--sidebar-width": "17.5rem" } as React.CSSProperties}
    >
      <Sidebar variant="floating" collapsible="none">
        <SidebarHeader className="p-2">
          <h1 className="truncate pt-3 pr-2 pl-4 text-xs font-semibold">
            {data.program.title}
          </h1>
        </SidebarHeader>

        <SidebarContent className="overflow-hidden pt-1">
          <ProgramFileTree
            files={data.files}
            initialPath={defaultPath}
            onFileSelect={setActivePath}
          />
        </SidebarContent>

        <SidebarFooter className="items-start">
          <Link
            to="/programs"
            aria-label="Programs"
            title="Programs"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
          </Link>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-h-0 overflow-hidden md:m-0 md:rounded-none md:shadow-none">
        <div className="program-code-view min-h-0 flex-1 overflow-auto">
          <EditProvider
            createEditor={(editorType, options, editStateKey) =>
              new Editor(editorType, options, editStateKey)
            }
          >
            <CodeView
              key={activeFile.path}
              items={codeItems}
              options={{
                disableFileHeader: true,
                theme: BIRDS_OF_PARADISE_THEME,
              }}
              style={
                {
                  "--diffs-font-family": "var(--font-mono)",
                } as React.CSSProperties
              }
            />
          </EditProvider>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
