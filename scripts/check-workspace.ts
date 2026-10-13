const commands = Bun.argv.includes("--build")
  ? [
      "packages/serial",
      "apps/code",
      "apps/brain",
      "apps/design",
      "apps/marketing",
    ].map((cwd) => ["bun", "run", "--cwd", cwd, "build"])
  : [
      ["bun", "run", "lint"],
      ["bun", "run", "test"],
      ["bun", "run", "--cwd", "apps/code", "test:backend"],
      ["bun", "run", "--cwd", "packages/serial", "check"],
      ["bun", "run", "--cwd", "packages/serial", "build:dts"],
      ["bun", "run", "--cwd", "packages/compiler", "typecheck"],
      ["bun", "run", "--cwd", "apps/code", "typecheck"],
      ["bun", "run", "--cwd", "apps/brain", "check"],
      ["bun", "run", "--cwd", "apps/design", "typecheck"],
      ["bun", "run", "--cwd", "apps/marketing", "typecheck"],
    ]

if (Bun.argv.includes("--build")) {
  commands.splice(1, 0, [
    "bun",
    "run",
    "--cwd",
    "packages/serial",
    "check:exports",
  ])
}

for (const command of commands) {
  console.log(`Running ${command.join(" ")}`)
  const process = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" })
  const exitCode = await process.exited
  if (exitCode !== 0) globalThis.process.exit(exitCode)
}
