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
import { QuestionMark } from '@phosphor-icons/react'

const templateInfo = {
  vexcode: { label: 'VEXcode', icon: '/template-icons/vexcode.png' },
  pros: { label: 'PROS', icon: '/template-icons/pros.png' },
  'ez-template': { label: 'EZ', icon: '/template-icons/ez.png' },
  'jar-template': { label: 'JAR Template', icon: '/template-icons/jar.svg' },
} as const

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
                    <span>JAR Template</span>
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
              <TableHead>Template</TableHead>
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
                <TableCell>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SidebarInset>
    </SidebarProvider>
  )
}
