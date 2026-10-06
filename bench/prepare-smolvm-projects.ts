import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import {
  initializeTemplate,
  type ProgramTemplate,
} from "../apps/code/convex/template"

const repo = resolve(import.meta.dir, "..")

const outputRoot = join(repo, ".build", "smolvm-bench-projects")

const templates: ProgramTemplate[] = ["vexcode", "pros", "ez-template"]

await rm(outputRoot, { recursive: true, force: true })

for (const template of templates) {
  const output = join(outputRoot, template)
  const writes: Promise<void>[] = []

  const repoStub = {
    defaultBranch: "main",
    createCommit: () => ({
      addFileFromString(path: string, contents: string) {
        const destination = join(output, path)

        writes.push(
          mkdir(dirname(destination), { recursive: true }).then(() =>
            writeFile(destination, contents)
          )
        )
      },
      send: async () => null,
    }),
  }

  await initializeTemplate(repoStub as never, template, {
    name: "SmolVM benchmark",
    email: "benchmark@example.invalid",
  })

  await Promise.all(writes)
}

console.log("Prepared synthetic projects under .build/smolvm-bench-projects")
