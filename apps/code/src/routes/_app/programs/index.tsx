import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { convexQuery } from "@convex-dev/react-query"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { api } from "../../../../convex/_generated/api"
import { useMutation } from "convex/react"
import boring from "boring-name-generator"

export const Route = createFileRoute("/_app/programs/")({
  component: RouteComponent,
})

const PROGRAM_ICON_SOURCES = {
  vexcode: "/icons/vexcode.webp",
  pros: "/icons/pros.svg",
  ez: "/icons/ez.webp",
} as const

function RouteComponent() {
  const { data: programs } = useSuspenseQuery(convexQuery(api.programs.list))
  const createProgram = useMutation(api.programs.create)

  const handleCreate = (framework: "vexcode" | "pros" | "ez") => {
    createProgram({
      framework,
      title: boring({ words: 2 }).dashed,
    })
  }

  return (
    <div className="flex h-screen w-screen flex-col p-6">
      <header className="flex shrink-0 flex-row justify-between border-b pb-2 text-2xl">
        <h1>Programs</h1>

        <div className="flex flex-row gap-1">
          <Button
            size="icon-lg"
            variant="ghost"
            onClick={() => handleCreate("vexcode")}
          >
            <img
              src={PROGRAM_ICON_SOURCES.vexcode}
              alt="VEXcode"
              className="h-6 w-6"
            />
          </Button>
          <Button
            size="icon-lg"
            variant="ghost"
            onClick={() => handleCreate("pros")}
          >
            <img
              src={PROGRAM_ICON_SOURCES.pros}
              alt="PROS"
              className="h-6 w-6"
            />
          </Button>
          <Button
            size="icon-lg"
            variant="ghost"
            onClick={() => handleCreate("ez")}
          >
            <img
              src={PROGRAM_ICON_SOURCES.ez}
              alt="EZ-Template"
              className="h-6 w-6"
            />
          </Button>
        </div>
      </header>

      <main className="flex flex-1">
        <Table>
          <TableBody>
            {programs.map((program) => (
              <TableRow
                key={program._id}
                className="relative hover:bg-muted/50"
              >
                <TableCell className="font-medium">
                  <Link
                    to="/programs/$programId"
                    params={{ programId: program._id }}
                    className="after:absolute after:inset-0"
                  >
                    {program.title}
                  </Link>
                </TableCell>
                <TableCell className="text-right">
                  <img
                    src={PROGRAM_ICON_SOURCES[program.framework]}
                    alt={program.framework}
                    className="inline-block h-6 w-6"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </main>
    </div>
  )
}
