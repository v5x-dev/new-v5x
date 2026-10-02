# Local C++ workspace

Pierre remains the editor. The Bun patch to `@pierre/diffs@1.4.3` adds selection callbacks, cursor rectangles, semantic colors, folding and read-only navigation. External edits use Pierre's undo history.

clangd 15.0.7 executes in a browser worker using WebAssembly pthreads. Project sources, real SDK headers and ARM compile commands live in its virtual filesystem. Language requests never go to a remote language server. Repository operations and existing builds still use the backend.

## Build and deployment

Run `bun install`, then `bun run build` in this directory. The build copies the pinned published clangd artifact and license from `@clangd-wasm/core`. It does not compile LLVM from source. Generated clangd files are ignored; SDK bundles and SHA-256 manifests are tracked.

Vite and Nitro set `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. Reverse proxies must preserve these headers. HTTPS or localhost, shared WebAssembly memory, workers, CacheStorage, IndexedDB and gzip DecompressionStream are required. Missing isolation produces an explicit error.

From the repository root, regenerate headers with `python3 scripts/package-language-sdk.py --sdk /path/to/sdk --rootfs /path/to/build-image-rootfs`. PROS 3.8.3 and EZ Template 3.2.2 use the verified archive URLs from `scripts/install-vex-build-assets.py`. The manifest records provenance. GCC 16's normal_iterator hidden friend return type uses an equivalent declval expression for compatibility with clang 15. Preserve upstream licenses and check vendor redistribution terms when publishing SDK assets.

Template flags target ARM. Custom projects may supply an argument-array `compile_commands.json` mapped to `/workspace`, `/sdk` and `/toolchain`, . Arbitrary Makefiles are not interpreted in the browser.

## Workspace behavior

The workspace loads project sources into the local clangd filesystem and preserves unsaved documents when navigating between files. Existing save controls commit changes against the expected repository head. Draft recovery uses IndexedDB.

The editor adds IntelliSense completion, Ctrl+click definition navigation and diagnostic underlines with Pierre's native hover tooltip. It retains the existing Pierre tree and floating sidebar. There are no added toolbars, tabs, problems panels or fix-action UI.

The production build emits an independent `/offline.html` shell and explicit asset manifest. The service worker caches static assets without caching authenticated SSR or API responses. Previously opened projects can recover locally; commits and builds require connectivity. Language assets and index shards are cached. Browser eviction can remove drafts, so commit work regularly.

## Verification

Run `bun test src/lib/ide src/lib/program-files.test.ts` and `bun run typecheck`. `bun run dev:ide` serves `/ide.html`, a development-only harness using the production workspace and real clangd with VEX, PROS, EZ and JAR fixtures. Fixture commits stay in memory. The harness is not emitted by the production app build and does not bypass authentication.

Tests cover UTF-16 and CRLF positions, overlapping edits, atomic stale-edit rejection, rename baselines, URI confinement, project search, ARM flags, semantic deltas and snippet remapping. Full authenticated commits, offline installation and native editing workflows require browser acceptance testing before claiming desktop IDE parity.
