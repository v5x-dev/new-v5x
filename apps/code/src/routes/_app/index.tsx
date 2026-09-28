import { createFileRoute, Link } from '@tanstack/react-router'
import { useAction } from 'convex/react'
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
} from '~/components/ui/sidebar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { api } from '../../../convex/_generated/api'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'

export const Route = createFileRoute('/_app/')({
  component: RouteComponent,
})

function RouteComponent() {
  const createProgram = useAction(api.program.createProgram)
  const { data: programs } = useQuery(convexQuery(api.program.list))

  return (
    <SidebarProvider>
      <Sidebar variant="floating">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Create</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={() => createProgram({})}>
                    VEXCode
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="max-h-screen overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {programs?.map((program) => (
              <TableRow key={program._id}>
                <TableCell>
                  <Link to="/p/$programId" params={{ programId: program._id }}>
                    {program.name}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SidebarInset>
    </SidebarProvider>
  )
}
