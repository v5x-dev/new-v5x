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

Web Bluetooth is available through `@v5x/serial/bluetooth`. Use
`V5BluetoothConnection` to discover V5 brains by their BLE service and use the
same protocol, file-transfer, and terminal APIs:

```ts
import { V5BluetoothConnection } from "@v5x/serial/bluetooth"
import { openUserProgramTerminal } from "@v5x/serial"

const connection = new V5BluetoothConnection()

// Call from a click handler to show the browser's device chooser.
if ((await connection.open(undefined)) === true) {
  if (!(await connection.isPaired())) {
    await connection.requestPairing()
    // Get the four-digit PIN displayed on the brain from your UI.
    await connection.authenticatePairing("0123")
  }

  const version = await connection.getSystemVersion()
  const terminal = openUserProgramTerminal(connection)
  terminal?.on("text", (text) => console.log(text))
  await terminal?.write("hello\n")
  // When finished: await terminal?.close(); await connection.close()
}
```

Pair before sending protocol or terminal writes. PIN strings preserve leading
zeros; a `Uint8Array` of four numeric digits is also accepted. BLE terminal
output arrives through notifications, and stdin uses a separate characteristic.
File transfers respect the 244-byte BLE packet limit and negotiated window;
file writes do not wait for acknowledgements, matching
[vexide/vex-v5-serial](https://github.com/vexide/vex-v5-serial).

Web Bluetooth requires a supported browser, a secure context such as HTTPS or
localhost, and a V5 radio configured for Bluetooth. Browser device permission
and the brain's PIN pairing are separate steps. `open(0, false)` attempts a
previously granted device without showing a chooser. Browsers without
`Bluetooth.getDevices()` can reuse devices selected by the same adapter during
the current page session. `createBluetoothAdapter(bluetooth)` accepts an
injected Web Bluetooth implementation for testing or embedding.

For local development:

```bash
bun run check
bun test
bun run build
bun run format
bun run format:check
```
