import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from "#/components/ui/sidebar"
import { createFileRoute, Outlet } from "@tanstack/react-router"

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
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  )
}
