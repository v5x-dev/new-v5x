import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
} from "#/components/ui/sidebar"
import { createFileRoute, Outlet } from "@tanstack/react-router"
import { useState } from "react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "#/components/ui/input-group"
import { BoxIcon, SearchIcon } from "lucide-react"
import { modelPaths, partName, PART_DRAG_TYPE } from "#/lib/parts"

const modelRoot = "/models/vex-v5rc-parts/"

function categoryLabel(category: string) {
  return category
    .split("/")
    .map((folder) =>
      folder === "c-channels"
        ? "C-Channels"
        : folder.replace(
            /(^|-)([a-z])/g,
            (_, separator, letter: string) =>
              `${separator ? " " : ""}${letter.toUpperCase()}`,
          ),
    )
    .join(" / ")
}

const partGroups = new Map<string, { path: string; name: string }[]>()

for (const path of modelPaths) {
  const relativePath = path.slice(modelRoot.length)
  const separator = relativePath.lastIndexOf("/")
  const category = relativePath.slice(0, separator)
  const part = {
    path,
    name: partName(path),
  }
  const parts = partGroups.get(category) ?? []

  parts.push(part)
  partGroups.set(category, parts)
}

export const Route = createFileRoute("/_app")({
  component: RouteComponent,
})

function RouteComponent() {
  const [query, setQuery] = useState("")
  const visibleGroups = Array.from(
    partGroups,
    ([category, parts]) =>
      [
        category,
        parts.filter((part) =>
          `${part.name} ${category}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        ),
      ] as const,
  ).filter(([, parts]) => parts.length > 0)
  return (
    <SidebarProvider>
      <SidebarInset className="h-screen overflow-hidden">
        <Outlet />
      </SidebarInset>
      <Sidebar side="right" collapsible="icon">
        <SidebarHeader className="group-data-[collapsible=icon]:hidden">
          <InputGroup>
            <InputGroupInput
              aria-label="Search parts"
              placeholder="Search parts"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
          </InputGroup>
        </SidebarHeader>
        <SidebarContent>
          {visibleGroups.map(([category, parts]) => (
            <SidebarGroup key={category}>
              <SidebarGroupLabel title={categoryLabel(category)}>
                {categoryLabel(category)}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {parts.map((part) => (
                    <SidebarMenuItem key={part.path}>
                      <SidebarMenuButton
                        asChild
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "copy"
                          event.dataTransfer.setData(PART_DRAG_TYPE, part.path)
                        }}
                        tooltip={part.name}
                      >
                        <div title={part.name}>
                          <BoxIcon />
                          <span>{part.name}</span>
                        </div>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  )
}
