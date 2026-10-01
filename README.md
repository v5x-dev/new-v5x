# v5x

This repository contains the current v5x rewrite. The serial protocol lives in
`packages/serial`; the web and framework adapter packages from the older
monorepo are intentionally not part of this workspace.

Install dependencies with Bun:

```sh
bun install
```

Run the serial package checks:

```sh
bun run --cwd packages/serial check
bun test
bun run --cwd packages/serial build
```

Run the app's end-to-end smoke test from the repository root:

```sh
bun run --cwd apps/code test:e2e
```

The e2e runner starts the app with its `dev` script. The app's local Convex
environment must be configured before running it.

Format the repository or verify its formatting:

```sh
bun run format
bun run format:check
```

The `@v5x/serial` package has runtime-specific adapters at
`@v5x/serial/browser`, `@v5x/serial/node`, and `@v5x/serial/bun`.
