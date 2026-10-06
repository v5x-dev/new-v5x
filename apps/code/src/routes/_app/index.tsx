import { Link, createFileRoute } from '@tanstack/react-router'
import { useAction } from 'convex/react'
import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { QuestionMark, SignOut } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
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
import { FeedbackDialog } from '~/components/feedback-dialog'
import { authClient } from '~/lib/auth-client'

const templateInfo = {
  vexcode: { label: 'VEXcode', icon: '/template-icons/vexcode.png' },
  pros: { label: 'PROS', icon: '/template-icons/pros.png' },
  'ez-template': { label: 'EZ', icon: '/template-icons/ez.png' },
  'jar-template': { label: 'JAR', icon: '/template-icons/jar.svg' },
} as const

export const Route = createFileRoute('/_app/')({
  component: RouteComponent,
})

function RouteComponent() {
  const { data: session } = authClient.useSession()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const user = session?.user
  const userName = user?.name || user?.email || 'Guest'

  const initials = userName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  async function signOut() {
    setIsSigningOut(true)
    setSignOutError(null)

    try {
      const { error } = await authClient.signOut()
      if (error) throw new Error(error.message || 'Unable to sign out')
      window.location.assign('/login')
    } catch {
      setSignOutError('Unable to sign out. Try again.')
      setIsSigningOut(false)
    }
  }

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
                  <SidebarMenuButton
                    onClick={() => createProgram({ template: 'vexcode' })}
                  >
                    <img
                      src={templateInfo.vexcode.icon}
                      alt=""
                      aria-hidden="true"
                      className="size-4 shrink-0 object-contain"
                    />
                    <span>VEXcode</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => createProgram({ template: 'pros' })}
                  >
                    <img
                      src={templateInfo.pros.icon}
                      alt=""
                      aria-hidden="true"
                      className="size-4 shrink-0 object-contain"
                    />
                    <span>PROS</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => createProgram({ template: 'ez-template' })}
                  >
                    <img
                      src={templateInfo['ez-template'].icon}
                      alt=""
                      aria-hidden="true"
                      className="size-4 shrink-0 object-contain"
                    />
                    <span>EZ</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => createProgram({ template: 'jar-template' })}
                  >
                    <img
                      src={templateInfo['jar-template'].icon}
                      alt=""
                      aria-hidden="true"
                      className="size-4 shrink-0 object-contain"
                    />
                    <span>JAR</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <FeedbackDialog />
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<div />}>
                <Avatar size="sm">
                  <AvatarImage src={user?.image || undefined} alt="" />
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <span title={userName}>{userName}</span>
              </SidebarMenuButton>
              <SidebarMenuAction
                aria-label="Sign out"
                title="Sign out"
                disabled={isSigningOut}
                onClick={signOut}
              >
                <SignOut aria-hidden="true" />
              </SidebarMenuAction>
            </SidebarMenuItem>
          </SidebarMenu>
          {signOutError && <p role="alert">{signOutError}</p>}
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="max-h-screen overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 min-w-10 px-2" aria-label="Template" />
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {programs?.map((program) => (
              <TableRow key={program._id}>
                <TableCell className="w-10 min-w-10 px-2">
                  {program.template ? (
                    <img
                      src={templateInfo[program.template].icon}
                      alt={templateInfo[program.template].label}
                      title={templateInfo[program.template].label}
                      className="size-6 object-contain"
                    />
                  ) : (
                    <QuestionMark
                      size={24}
                      role="img"
                      aria-label="Unknown template"
                    />
                  )}
                </TableCell>
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
