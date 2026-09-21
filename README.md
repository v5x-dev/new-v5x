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

The `@v5x/serial` package has runtime-specific adapters at
`@v5x/serial/browser`, `@v5x/serial/node`, and `@v5x/serial/bun`.
