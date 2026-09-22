# @v5x/serial

`@v5x/serial` implements the VEX V5 CDC serial protocol. The package contains
the packet models, V5 connection, file transfers, device state, screen capture,
firmware upload helpers, and user-program terminal support.

Install it with Bun:

```bash
bun add @v5x/serial
```

The protocol is transport-independent. Supply an adapter for the runtime you
are using:

```ts
import { V5SerialConnection } from "@v5x/serial"
import { createBrowserAdapter } from "@v5x/serial/browser"

const connection = new V5SerialConnection(createBrowserAdapter())
if ((await connection.open()) === true) {
  const version = await connection.getSystemVersion()
  const terminal = connection.openTerminal()
  terminal?.on("text", (text) => console.log(text))
}
```

The package also exports `createNodeAdapter` and `createBunAdapter` from their
runtime-specific entry points. Close connections and terminal sessions when
the owning view or process is done with them.

For local development:

```bash
bun run check
bun test
bun run build
bun run format
bun run format:check
```
