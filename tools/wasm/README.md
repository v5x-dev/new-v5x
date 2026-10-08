# Browser Wasm build

The browser runs the ARM kernel and user binary inside QEMU compiled to Wasm.
The kernel remains ARM machine code. A second Wasm module decodes the existing
bincode UART protocol and uses the native host's Rust display renderer.
No server executes programs or receives uploaded binaries.

## Build and run

Install the repository's pinned Rust toolchain, Node.js, and Docker with BuildKit.
From `apps/brain`:

```sh
bun install
bun run wasm:build
bun run dev
```

The first build downloads QEMU 10.1.0 and builds its Emscripten dependencies.
Later builds reuse Docker's dependency cache. Generated artifacts go in
`apps/brain/public/wasm` and are committed. `bun run build` verifies they exist before
building a static site. Build the artifacts again whenever the kernel, protocol,
renderer, or browser transport changes.

For a local build without Docker, activate Emscripten 3.1.50 and install Meson
1.5.0, Ninja, pkg-config, Python, autotools, git and curl. Then run:

```sh
V5_WASM_LOCAL=1 bun run wasm:build
```

## Deployment

Serve the contents of `apps/brain/dist` over HTTPS or localhost. Every page
must have these response headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Serve `.wasm` as `application/wasm`, and `.js` as JavaScript. All emulator assets
are same-origin. Vite development and preview servers set the isolation headers.
A static host that cannot configure these headers cannot run this pthread build.
The runtime checks isolation before creating workers and reports missing assets.

## QEMU research and design

[QEMU 10.1's Emscripten configuration](https://github.com/qemu/qemu/blob/v10.1.0/configs/meson/emscripten.txt)
and its [dependency Dockerfile](https://github.com/qemu/qemu/blob/v10.1.0/tests/docker/dockerfiles/emsdk-wasm32-cross.docker)
provide upstream Wasm support. Use `--enable-tcg-interpreter`, since the ordinary
native TCG backend generates executable host instructions that a browser cannot
execute. [Pebble's ARM browser emulator](https://github.com/ericmigi/pebble-qemu-wasm)
also uses this upstream QEMU build path. [ktock/qemu-wasm](https://github.com/ktock/qemu-wasm)
explores Wasm JIT backends, but this project uses upstream TCI to avoid depending
on an experimental QEMU fork.

The overlay in `patch-qemu.py` keeps the native packet directions. The kernel
writes host-bound packets with semihosting stdout, and those bytes go into a
shared output ring instead of Emscripten's text console. Host-bound battery and
other device packets are written into the guest UART through a named ringbuf
chardev. Shared atomic ring buffers carry the raw bytes between QEMU's pthread
and its parent worker. Input and pause/resume requests are polled by a QEMU
realtime timer under the main loop's lock. Output uses backpressure instead of
dropping bytes, preserving packet boundaries. The browser host accepts fragmented packets
and caps packet sizes at 16 MiB. The parent worker coalesces display updates and
transfers RGBA frames to the UI. Each session owns its workers; unload/reset
terminates QEMU's pthreads and discards its virtual filesystem.

QEMU uses a fixed virtual instruction clock to drive the ARM timers. TCI is slower
than native QEMU, so this runtime is useful for execution and debugging but does
not promise real-time robot timing. The initial Wasm memory is 512 MiB and may
grow to 2 GiB. Browser memory limits can prevent it from running on small devices.

The browser supports the same single `.bin` upload as the earlier web bridge.
PROS hot/cold project loading and TCP GDB still use the native CLI. Scrolling is
not implemented by the existing Rust renderer. Desktop Tauri and the native CLI
continue to use native QEMU.

## Licenses

The kernel, protocol, and display renderer come from
[vex-v5-qemu](https://github.com/vexide/vex-v5-qemu) and stay under that
project's [MIT license](https://github.com/vexide/vex-v5-qemu/blob/main/LICENSE).
Maintainers and contributors:
[Tropical](https://github.com/tropicaaal),
[Lewis McClelland](https://github.com/lewisfm),
[Gavin Niederman](https://github.com/Gavin-Niederman),
[ion098](https://github.com/ion098),
[Max Niederman](https://github.com/max-niederman),
[Jamie M](https://github.com/jmakif),
[Andrew Curtis](https://github.com/meisZWFLZ),
and doinkythederp, named as an author of the protocol crate.
`apps/brain` shows this list in the sidebar and serves it at `/credits.html`,
including the MIT notice.

QEMU and the browser transport overlay are GPL-2.0-or-later. The build copies
QEMU's `COPYING` alongside the artifacts. If distributing the generated emulator,
provide its corresponding source, including this overlay and build scripts, in
accordance with the QEMU license. QEMU source is pinned by archive checksum in
`build.sh`; Emscripten and dependency versions come from its upstream Dockerfile.
