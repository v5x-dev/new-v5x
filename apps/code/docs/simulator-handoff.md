# Run a VEXcode build in Brain

Code's project page can send the latest VEXcode, PROS, or EZ-Template build to Brain's browser
simulator. It uploads a versioned manifest and binary to the Code Convex
deployment, then opens Brain with a short-lived, one-use token. Brain accepts
the token only from its configured Code Convex site, and the backend accepts
requests only from `https://brain.v5x.dev` by default.

For local development, point Code at Brain and allow Brain's origin in the same
development Convex deployment:

```sh
VITE_BRAIN_APP_URL=http://localhost:5173
VITE_CODE_CONVEX_SITE_URL=https://<development-deployment>.convex.site
bunx convex env set V5X_BRAIN_ORIGINS http://localhost:5173
```

Set `VITE_BRAIN_APP_URL` in Code's environment and
`VITE_CODE_CONVEX_SITE_URL` in Brain's environment. Use the exact Convex site
URL from Code's `VITE_CONVEX_SITE_URL`. Add another exact Brain origin to
`V5X_BRAIN_ORIGINS` when the local app uses a different port. Do not use `*`.

VEXcode sends `build/workspace.bin` as a raw program. PROS and EZ-Template
send a `build/simulator.v5x` package containing both `bin/cold.package.bin`
and `bin/hot.package.bin`. The versioned package header records their lengths;
the handoff digest covers the header and both binaries. Brain loads cold code
at `0x03800000`, hot code at `0x07800000`, and sets the kernel link address to
`0x03800000`. JAR is unsupported.

Brain's program file picker also accepts `.v5x` packages. Raw hot-package files
cannot run alone. The package is limited to 32 MiB total and 8 MiB of hot code.
The existing authenticated, short-lived, one-use transfer and origin checks
apply to all three supported templates.

For a quick Chromebook build check, open `/build-demo` on the Code app.
No project or login is required. Choose a template, build once for download and
startup cost, build again for reuse, then edit `src/main.cpp` and build again
for actual compilation cost. The page reports elapsed seconds and uses the
same browser compiler as `/p/:programId`. Check editor responsiveness and
cancellation too. This quick check does not measure total WASM peak memory.
