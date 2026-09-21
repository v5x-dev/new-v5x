# v5x monorepo

This repository is the current rewrite of the v5x project. It is a Bun
workspace for VEX V5 software. The workspace currently contains the reusable
V5 serial protocol library and the Code application that stores and edits VEX
programs.

The rewrite does not try to reproduce every package from the old monorepo.
`@v5x/events` was replaced by `events.vex`, and `@v5x/internal` is no longer
needed. The old web packages, framework adapters, and CLI are intentionally
out of scope. Do not reintroduce them as part of a routine change.

## Repository layout

```text
packages/serial/   @v5x/serial, the VEX V5 CDC serial protocol library
apps/code/         @v5x/code, the TanStack Start application
artifacts/         ignored local assets and generated working files
```

The root `package.json` is private and defines the Bun workspaces:
`packages/*` and `apps/*`. The root `tsconfig.json` contains shared strict
TypeScript defaults. Each workspace owns its build and development scripts.

## `@v5x/serial`

`packages/serial` is the main reusable library in this repository. It models
VEX V5 packets and CRCs, manages the V5 connection and request lifecycle, and
provides device operations such as file transfers, firmware helpers, device
state, screen capture, and the user-program terminal.

The protocol code is transport-independent. Runtime-specific transport code
lives in `src/adapters`:

- `@v5x/serial/browser` uses the Web Serial API.
- `@v5x/serial/node` uses `serialport`.
- `@v5x/serial/bun` uses `bun-serialport`.

The main `@v5x/serial` entry point exports the VEX protocol and device APIs.
`@v5x/serial/packet-core` contains the lower-level packet helpers. Keep the
main entry point free of browser, Node, and Bun-only imports so consumers can
choose the adapter for their runtime.

Most protocol implementation is under `packages/serial/src/vex`. Tests live
next to that code and run with Bun. The package builds ESM, a CommonJS main
entry point, and TypeScript declarations into `packages/serial/dist`.

When changing this package:

- Keep adapter-specific dependencies out of the shared protocol modules.
- Preserve explicit connection and terminal cleanup for callers.
- Update tests for packet, connection, lifecycle, and protocol behavior when
  changing those areas.
- Treat `dist` as build output. Edit `src`, then rebuild it.

## `@v5x/code`

`apps/code` is a private TanStack Start and React application. Vite provides
the development and production build, and Convex provides the backend.
Better Auth handles email and password sessions.

The app currently includes:

- TanStack Router routes for the landing page, authentication, and programs.
- A program list and program detail view for C++ and Python VEX projects.
- Convex queries and mutations in `convex/programs.ts`.
- Convex schema tables for `programs` and `programFiles`.
- Built-in C++ and Python starter files in `convex/templates.ts`.
- Auth handlers under `src/routes/api/auth` and shared auth helpers in
  `src/lib`.
- Shared UI components in `src/components/ui` and the V5 robot brain viewer.

`src/routeTree.gen.ts` and `convex/_generated` are generated files. Change the
source routes or Convex functions, then use the relevant generator instead of
hand-editing generated output.

For local app work, run `bun run --cwd apps/code convex:dev` once the Convex
deployment is configured. It creates or updates `.env.local` and
`convex/_generated`. Set `SITE_URL=http://localhost:3000` in `.env.local`,
then run the Vite app with `bun run --cwd apps/code dev`.

## Common commands

Run these from the repository root unless a command includes `--cwd`.

```sh
bun install

# serial library
bun run --cwd packages/serial check
bun run --cwd packages/serial test
bun run --cwd packages/serial build

# Code app
bun run --cwd apps/code dev
bun run --cwd apps/code build
bun run --cwd apps/code typecheck
bun run --cwd apps/code lint
bun run --cwd apps/code test
bun run --cwd apps/code check
bun run --cwd apps/code convex:dev
bun run --cwd apps/code convex:deploy
```

Use `bun test` for Bun tests. The Code app currently uses Vitest through its
own `test` script because its frontend toolchain is Vite-based. `check` in the
app runs Prettier's check, while `typecheck` runs TypeScript.

## Working conventions

- Use Bun for package installation, scripts, and new runtime code unless a
  package's existing toolchain requires something else.
- Keep TypeScript strict and use the existing bundler-oriented module
  settings. Do not add a second package manager or a parallel build system.
- Use `Bun.file`, `bun:sqlite`, `Bun.serve`, and other Bun APIs when writing
  Bun-specific code. Do not add Express, `better-sqlite3`, or `ioredis`.
- The Code app intentionally uses Vite and TanStack Start. Do not replace
  that toolchain with a different frontend server.
- Keep changes inside the workspace that owns them. Shared serial behavior
  belongs in `packages/serial`; UI, auth, and program persistence belong in
  `apps/code`.
- Do not commit `.env` files, build output, coverage, or local artifacts.
- Prefer small focused changes. Before handing off a change, run the checks
  for the affected workspace and build the serial package when its public API
  changes.

There is no root test, build, or dev script. Use the workspace commands above.
The root README and each package README should stay aligned with public
commands and entry points when those change.

## UI changes

- Always use Tailwind CSS utility classes and shadcn/ui components when writing UI code. Prefer existing shadcn/ui primitives and Tailwind classes over bespoke component CSS.
- For every UI change, use `agent-browser` to open and verify the changed UI at
  a 1920x1080 viewport. Screenshots must be captured at exactly 1920x1080
  (1080p, 16:9). Before finishing the task, take a screenshot of the change
  and attach it to the thread.
