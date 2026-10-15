import { createFileRoute } from '@tanstack/react-router'
import type { Id } from '../../../../convex/_generated/dataModel'
import { ProgramWorkspace } from '~/components/ide/program-workspace'

export const Route = createFileRoute('/_app/p/$programId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { programId } = Route.useParams()

  return (
    <ProgramWorkspace key={programId} programId={programId as Id<'program'>} />
  )
}
