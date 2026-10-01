# Browser C/C++ tools

Pierre's existing edit mode connects to clangd in a dedicated browser worker.
Clangd, its parser threads, project filesystem, and index run on the user's device.
Opening an editor never creates a Smol machine. Cloud builds remain separate.

## Build and deploy

`bun run dev` and `bun run build` run `lsp:prepare` automatically. It downloads
checksum-pinned LLVM 21.1/Emscripten 4.0.22 artifacts, adapts the thread pool and
shared-memory minimum, verifies the SDK packs, and creates gzip/Brotli sidecars.
Generated compiler artifacts are ignored by Git. Deploy the complete Nitro
`.output` directory, including `.output/public/lsp`.

The pinned WASM module is about 121 MiB before compression. Nitro serves the
precompressed copy when the client accepts gzip/Brotli. The worker caches the
uncompressed module and selected SDK packs in Cache Storage. Actual compressed
sizes are shown by `ls -lh public/lsp/v1/clangd.wasm.*` after preparation.

The supplied compiler initializes 256 MiB of shared linear memory and can grow
up to 4 GiB. Six worker threads are pooled; clangd uses two parser workers and
background indexing at low priority. Total browser memory also includes the
compiled module, SDK files, project files, and ASTs. Large projects can exceed
small devices' memory budgets.

Vite and Nitro send COOP `same-origin` and COEP `credentialless`. Production
proxies must preserve these headers. Use HTTPS or localhost. Without
`crossOriginIsolated` and `SharedArrayBuffer`, the UI reports why local tools
cannot start and offers retry. There is no paid server fallback.

## SDKs and compilation profiles

The checked-in compressed packs contain actual headers from the build toolchain:

- VEXcode/JAR: VEX V5 SDK, GCC 4.9.3 headers, and Clang builtin headers.
- PROS: kernel 3.8.3, ARM GCC 16.1.0/Newlib headers, and Clang builtin headers.
- EZ: the headers included in the pinned EZ Template 3.2.2 example archive,
  including its PROS API, plus the ARM standard library pack.

Project headers override SDK headers. Profiles preserve ARM Cortex-A9 flags,
defines, and each template's C/C++ language standard. `.v5x-lsp.json` supports
additional compiler flags, for example:

```json
{ "flags": ["-I/workspace/vendor/include", "-DMY_FEATURE=1"] }
```

Clangd also reads a project's `.clangd` configuration. Reload the editor after changing compilation configuration. Project Makefiles are not
executed by the browser, so arbitrary custom Makefile flags/generated headers
must be provided through configuration or checked-in source.

Saved files update the worker filesystem and notify clangd's file watcher.
Unsaved edits use LSP document overlays and do not enter repository storage.
Derived project indexes persist in IndexedDB, capped at eight cached indexes and
32 MiB per index. Compiler flags, SDK versions, and Clang configuration contribute
to the cache key. Storage failures simply disable persistence. Closing the
editor terminates the worker and its child threads.

## Rebuilding assets

To rebuild LLVM rather than download the pinned artifact:

```sh
bash browser-lsp/build-source.sh
```

This pins LLVM 21.1.0 and Emscripten 4.0.22, builds native TableGen tools, applies
the asynchronous stdin patch, and compiles clangd. `LSP_BUILD_JOBS` defaults to 2.
The script updates `artifacts.json` for its output. Publish the generated assets
with that matching manifest; a fresh checkout cannot download a custom binary
from the upstream mirror. Source builds omit the demo's embedded WASI sysroot.

To regenerate SDK packs, extract these header directories from the robot build
image into `browser-lsp/.build/sdk`, preserving their absolute-path structure:

```text
/sdk/vexv5/include
/sdk/vexv5/gcc/include
/sdk/vexv5/clang/8.0.0/include
/usr/arm-none-eabi/include
/usr/lib/llvm20/lib/clang/20/include
```

Extract the PROS kernel archive into `browser-lsp/.build/pros` and the EZ example
archive into `browser-lsp/.build/ez`, then run `bun run lsp:pack-sdk`. Update SDK
checksums in `artifacts.json` when intentionally changing packs. The pinned
archive URLs and hashes are recorded in `sdk-sources.json`.

## Attribution

The browser port and stdin patch are based on
[guyutongxue/clangd-in-browser](https://github.com/guyutongxue/clangd-in-browser),
commit `4acd71dec6428906271e922f119d794344e0d35e`.
See `PORT-LICENSE.txt` and `LLVM-LICENSE.txt`. SDK files retain their upstream
copyright/license notices; PROS uses MPL 2.0, EZ and JAR use MIT, and ARM GCC's
standard library headers include the GCC Runtime Library Exception.
