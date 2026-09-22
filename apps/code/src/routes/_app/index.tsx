import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useAction } from 'convex/react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
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
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { SignOutIcon } from '@phosphor-icons/react'
import { authClient } from '~/lib/auth-client'

export const Route = createFileRoute('/_app/')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()

  const createProgram = useAction(api.program.createProgram)

  const { data: programs } = useQuery(convexQuery(api.program.list))

  const { data: user } = useQuery(convexQuery(api.auth.getCurrentUser))

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

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton>
                <Avatar size="sm">
                  <AvatarImage src={user?.image || undefined} />
                  <AvatarFallback>{user?.name[0]}</AvatarFallback>
                </Avatar>
                {user?.name}
              </SidebarMenuButton>
              <SidebarMenuAction
                onClick={async () => {
                  await authClient.signOut()
                  navigate({ to: '/login' })
                }}
              >
                <SignOutIcon />
              </SidebarMenuAction>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
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
              <TableRow>
                <TableCell>
                  <Link
                    to="/p/$programId"
                    params={{ programId: program._id }}
                    className="hover:underline"
                  >
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
