import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
} from "#/components/ui/sidebar"
import { createFileRoute, Outlet } from "@tanstack/react-router"
import { BoxIcon } from "lucide-react"
import { modelPaths, PART_DRAG_TYPE } from "#/lib/parts"

const modelRoot = "/models/vex-v5rc-parts/"

const PART_LABELS: Record<string, string> = {
  "/models/vex-v5rc-parts/angles/aluminum/1x1x35-aluminum-angle.glb":
    "1x1x35 Aluminum Angle",
  "/models/vex-v5rc-parts/angles/steel/2x2x25-steel-angle.glb":
    "2x2x25 Steel Angle",
  "/models/vex-v5rc-parts/angles/steel/2x2x35-steel-angle.glb":
    "2x2x35 Steel Angle",
  "/models/vex-v5rc-parts/angles/steel/3x3x35-steel-angle.glb":
    "3x3x35 Steel Angle",
  "/models/vex-v5rc-parts/bars/1x25-steel-bar.glb": "1x25 Steel Bar",
  "/models/vex-v5rc-parts/bars/drive-shaft-bar-lock.glb":
    "Drive Shaft Bar Lock",
}

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
    name: relativePath
      .slice(separator + 1)
      .replace(/\.glb$/, "")
      .trim(),
  }
  const parts = partGroups.get(category) ?? []

  parts.push(part)
  partGroups.set(category, parts)
}

export const Route = createFileRoute("/_app")({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <SidebarProvider>
      <SidebarInset className="h-screen overflow-hidden">
        <Outlet />
      </SidebarInset>
      <Sidebar side="right" collapsible="icon">
        <SidebarContent>
          {Array.from(partGroups, ([category, parts]) => (
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
                        tooltip={PART_LABELS[part.path] || part.name}
                      >
                        <div title={PART_LABELS[part.path] || part.name}>
                          <BoxIcon />
                          <span>{PART_LABELS[part.path] || part.name}</span>
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
