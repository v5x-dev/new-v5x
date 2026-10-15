# v5x compilation server

Build VEX V5 projects from `apps/code` on another computer over WebSocket. By default, the server uses the pinned LLVM WASM compiler and ARM SDK. Set `--native-toolchain` to use an installed Arm LLVM 21.1.1 toolchain instead. Both backends stream compiler output and return the artifacts used by Brain upload and simulation. The WASM backend needs no ARM toolchain installation.

After this package is published, launch it with Bun:

```sh
bunx @v5x/compile-server --host 0.0.0.0
```

For native compilation, pass the directory containing the toolchain's `bin`, `lib`, and `include` directories:

```sh
bunx @v5x/compile-server --host 0.0.0.0 \
  --native-toolchain /opt/arm-toolchain/ATfE-21.1.1-Linux-x86_64
```

The server checks for Arm LLVM 21.1.1 (toolchain ID E0058) before building. You can set `V5X_NATIVE_TOOLCHAIN` instead of passing the option. There is no machine-specific toolchain path in the package. Native compilation stays warm between builds; omitting the native path selects the WASM backend.

Open a program in code, choose **More actions → Compilation server**, paste the printed URL, replace `<server-host>` with the faster computer's address, and click **Connect**. The URL includes a generated access token. You can also paste a Cloudflare tunnel base URL and enter the terminal token in the separate **Access token** field; code adds `/compile` and converts HTTPS to secure WebSocket automatically. Settings stay in that browser. **Use browser** switches back to local compilation. Remote connection failures are reported without starting a local build.

The first build downloads the compiler and SDK from `https://code.v5x.dev` when using WASM, or the SDK when using native compilation. Downloads are checked against their SHA-256 digests and cached under `~/.cache/v5x-compile-server`. The selected compiler stays warm between builds, the server accepts one build at a time, and it cancels compilation when the client disconnects. Source uploads are limited to 6 MB and artifacts to 64 MB. Artifacts use binary WebSocket frames with a 1 MiB acknowledgement window instead of base64 JSON.

The default bind address is `127.0.0.1`. Use `--host 0.0.0.0` to accept connections from another computer. An HTTPS application requires `wss://` for remote connections. Supply a trusted TLS certificate for the server's hostname:

```sh
bunx @v5x/compile-server --host 0.0.0.0 --cert ./server.crt --key ./server.key
```

Alternatively, put a TLS reverse proxy or secure tunnel in front of port 8787, with WebSocket upgrades enabled. Connect with `wss://your-host/compile?token=...`. The allowed browser origin defaults to `https://code.v5x.dev`; add other application origins with `--origin https://your-code-host`. Possession of the token grants compilation access. Project files are sent to this server, so use a server you trust.

```sh
bunx @v5x/compile-server --help
```

For a stable URL, set `V5X_COMPILE_TOKEN` or pass `--token` with at least 16 characters. `--port`, `--assets-url`, and `--cache-dir` override the listening port, compiler asset host, and cache location. `--native-command-timeout` sets the timeout for each native command, from 1 to 120000 milliseconds.

From this repository, run before publication:

```sh
bun run --cwd packages/compile-server dev --origin http://localhost:3001 --assets-url http://localhost:3001
```

To build and inspect the distributable:

```sh
bun run --cwd packages/compile-server build
bun packages/compile-server/dist/cli.js --help
bun pm pack --cwd packages/compile-server
```

The native integration test builds all four canonical `apps/code` templates and repeats a warm VEXcode build. Run it with the toolchain and asset server configured:

```sh
V5X_NATIVE_INTEGRATION=1 \
V5X_NATIVE_TOOLCHAIN=/path/to/ATfE-21.1.1-Linux-x86_64 \
V5X_NATIVE_ASSETS_URL=http://localhost:3002 \
bun test packages/compile-server/src/native-build.test.ts
```

The published package contains bundled JavaScript and has no runtime package dependencies. Its build bundles the compiler workspace package and the repository's patched `microbit-clang-wasm` runtime. Compiler assets are downloaded on demand rather than included in the package.

The compilation channel offloads builds and linking. The separate language channel can offload editor completion, diagnostics, definitions, and other LSP requests to native clangd.

When the editor is configured to use this server for language features, the same URL and token connect to its `/language` WebSocket. That service runs native clangd 15 or newer inside bubblewrap. Install `bubblewrap` at `/usr/bin/bwrap`; Linux user, PID, and network namespaces must be enabled. Set `V5X_BWRAP_PATH` or `V5X_CLANGD_PATH` to use executables elsewhere. clangd must resolve under `/usr` so the sandbox can mount its runtime read-only. The sandbox mounts the current session's workspace, SDK, toolchain, private home, and private temporary directory. It also mounts `/usr`, `/lib`, and `/lib64` read-only, with private `/proc` and `/dev` mounts. It does not start clangd without bubblewrap.
