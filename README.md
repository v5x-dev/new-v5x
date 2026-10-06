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

Format the repository or verify its formatting:

```sh
bun run format
bun run format:check
```

The `@v5x/serial` package has runtime-specific adapters at
`@v5x/serial/browser`, `@v5x/serial/node`, and `@v5x/serial/bun`.

Vercel deploys `apps/code` from `main`. Its build command is tracked in
`apps/code/vercel.json` and deploys Convex before building the production frontend.
A failed Convex deployment stops the frontend release. Preview builds skip the
production backend deployment.

The Vercel project must have `CONVEX_DEPLOY_KEY` set for the Production environment
using a deploy key for the production Convex deployment. Keep this key in Vercel's
environment settings, never in the repository.
