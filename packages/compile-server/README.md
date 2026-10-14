# v5x compilation server

Build VEX V5 projects from `apps/code` on a faster computer over WebSocket. The server uses the same pinned LLVM WASM compiler, ARM SDK, and linker as browser builds. It streams compiler output and returns the binary artifacts used by Brain upload and simulation. No ARM toolchain installation is required.

After this package is published, launch it with Bun:

```sh
bunx @v5x/compile-server --host 0.0.0.0
```

Open a program in code, choose **More actions → Compilation server**, paste the printed URL, replace `<server-host>` with the faster computer's address, and click **Connect**. The URL includes a generated access token. Settings stay in that browser. **Use browser** switches back to local compilation. Remote connection failures are reported without starting a local build.

The first build downloads the compiler and SDK from `https://code.v5x.dev`. Downloads are checked against their SHA-256 digests and cached under `~/.cache/v5x-compile-server`. The server keeps a compiler worker warm between builds, accepts one build at a time, and cancels compilation when the client disconnects. Source uploads are limited to 6 MB and artifact downloads to 64 MB.

The default bind address is `127.0.0.1`. Use `--host 0.0.0.0` to accept connections from another computer. An HTTPS application requires `wss://` for remote connections. Supply a trusted TLS certificate for the server's hostname:

```sh
bunx @v5x/compile-server --host 0.0.0.0 --cert ./server.crt --key ./server.key
```

Alternatively, put a TLS reverse proxy or secure tunnel in front of port 8787, with WebSocket upgrades enabled. Connect with `wss://your-host/compile?token=...`. The allowed browser origin defaults to `https://code.v5x.dev`; add other application origins with `--origin https://your-code-host`. Possession of the token grants compilation access. Project files are sent to this server, so use a server you trust.

```sh
bunx @v5x/compile-server --help
```

For a stable URL, set `V5X_COMPILE_TOKEN` or pass `--token` with at least 16 characters. `--port`, `--assets-url`, and `--cache-dir` override the listening port, compiler asset host, and cache location.

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

The published package contains bundled JavaScript and has no runtime package dependencies. Its build bundles the compiler workspace package and the repository's patched `microbit-clang-wasm` runtime. Compiler assets are downloaded on demand rather than included in the package.

This connection offloads compilation and linking. Editor completion, diagnostics, and semantic highlighting still use the browser's language service.
