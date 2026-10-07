# Browser builds

The Build button on `/p/:programId` compiles the editor's committed workspace in
a dedicated browser worker. It does not call `programBuild.build`, allocate a
cloud machine, send source to a compiler service, or download build artifacts.
Clang and LLD execute as WebAssembly through pinned `microbit-clang-wasm`.
Its ARM backend can target the V5's Cortex-A9. We discard its micro:bit runtime
libraries and use the existing V5 SDK and ARM GCC libraries.

All four templates are supported. VEXcode and JAR produce `build/workspace.bin`.
PROS and EZ produce `bin/hot.package.bin` and `bin/cold.package.bin` using
upstream's separate memory layouts. The cold package contains the SDK libraries;
the hot package links the user's program against the cold package's symbols.
Brain upload consumes both packages directly and reuses a matching cold library
already on the Brain.

Compiler output streams to the existing Output panel. Every build gets a fresh
project filesystem. The compiler worker stays warm for up to 60 seconds between
builds and terminates on navigation or a five-minute build timeout. A local
intermediate cache checks compiler arguments, SDK versions, the workspace file
inventory, and every compiler-reported dependency before reusing objects. Deleted
headers, changed flags, and removed sources cannot reuse stale objects. Cold
packages are cached against their complete library and linker-script inputs. Binaries and failed compiler logs remain in IndexedDB
on this device and restore for the same commit. The same commit can be rebuilt.

## Offline use

Compiler assets download on first use. Production serves Brotli or gzip
companions prepared alongside the original files. Clang WASM and its resource
archive total about 16.3 MB over Brotli; clangd adds 11.3 MB for language support.
Decoded bytes retain the original manifest checksums. Development serves the
uncompressed originals.
SDK download sizes depend on the template. Every asset has a size and SHA-256
check. Cache Storage retains the assets, and the workspace service worker caches
language and compiler assets. Manifests refresh online and use their cache
offline. Clearing site storage removes the toolchain, workspaces, and binaries.

After an online build, an already-open project can rebuild using its cached
compiler and SDK without a network connection. Opening or reloading an
authenticated project and committing changes require the repository service.
There is no standalone offline workspace page.

## Project configuration

The browser compiles C, C++, and assembly files under `src/`, including nested
directories. Template flags preserve the V5 ABI. It reads literal
`EXTRA_CFLAGS`, `EXTRA_CXXFLAGS`, `C_STANDARD`, and `CXX_STANDARD` assignments from
PROS/EZ Makefiles, and `CFLAGS` and `CXX_FLAGS` assignments from VEXcode/JAR
Makefiles. Quoted flag values and joined or separate include paths work.

An explicit `compile_commands.json` can select other workspace sources and
compiler arguments. Commands must use `/workspace` as their directory and
absolute `/workspace/...` file paths. The browser uses Clang, supplies its own
output paths, and selects the built-in template linker configuration.
Arbitrary make rules, shell commands, make variable expressions, custom binary
libraries, and custom linker configurations are not interpreted. Those projects
need a browser build adapter. The UI does not fall back to cloud compilation.
The legacy cloud action remains available to existing tooling.

## Assets and compatibility fixes

`bun run prepare:language` prepares checked EZ precompiled headers and copies
the pinned compiler WebAssembly, licenses, and builtin headers into `public/compiler/llvm-21.11.0-alpha.1`. Generated compiler
assets are ignored by Git and prepared for development and production builds.
Binary SDK bundles and their provenance manifest are committed. Packaging
removes debug sections from the archives without changing loadable code. EZ's
library download shrinks from 21 MB to 2.14 MB after stripping debug records
and inheriting identical firmware files from PROS. Its precompiled-header asset adds
13.7 MB on first use; subsequent builds reuse it locally. Precompiled headers
apply only when compiler flags, the workspace inventory, and all header bytes
match. Other projects compile their headers normally. Regenerate them
from the SDK and rootfs used to package the language headers:

```sh
python3 scripts/package-build-sdk.py --sdk /path/to/sdk --rootfs /path/to/rootfs
```

The header and library manifests list the ordered bundles for each template.
Clang 8 builtin headers are shared separately. VEX/JAR load their GCC 4.9 headers
and VEX libraries; PROS/EZ load GCC 16 headers and ARM support libraries. The ARM
bundle contains only libgcc and libstdc++; libc and libm come from the template's
firmware. EZ overlays its distinct firmware files over PROS and inherits five
byte-identical files, recorded in its provenance. Both workers use these manifest
lists, so PROS/EZ do not download VEX libraries or GCC 4.9 headers.

SDK packaging retains shared C++ target headers and the selected V5 multilib:
`armv7-ar/thumb` for VEX/JAR and `thumb/v7+fp/softfp` for PROS/EZ. It omits other
multilib variants, x86/PowerPC/SystemZ intrinsics, OpenCL/CUDA, and host sanitizer
headers from the Clang 8 bundle. ARM NEON and ARM ACLE headers remain available.
Changing to another target configuration requires repackaging the headers.

| SDK downloads, excluding compiler and EZ PCH |   Before |   After |
| -------------------------------------------- | -------: | ------: |
| VEXcode/JAR                                  |  3.79 MB | 3.12 MB |
| PROS                                         | 10.60 MB | 5.72 MB |
| EZ                                           | 13.66 MB | 8.24 MB |

The adapter overrides Clang's `__INT32_TYPE__` and `__UINT32_TYPE__` to match
ARM GCC's `long` typedefs. This preserves C++ symbol names in prebuilt libraries. Direct `arm_neon.h`
inclusion currently triggers a compiler-runtime trap with these typedef
macros. The trap also reproduces with the original, untrimmed SDK; removing the
macros permits compilation but changes the SDK ABI, so it is not a safe fix.
It translates GNU ld's `.text` boot-header offset to an explicit address for LLD
and disables ELF RELRO. Packaging marks the PROS archives' `.freertos_vectors`
section allocatable and executable so LLD can apply its branch relocations.
Instructions and relocation entries remain intact.

The cold link retains all library sections with `--no-gc-sections`, so later hot
programs can use SDK functions absent from the initial program. Hot builds still
remove unused sections. Before linking the hot program, the adapter hides the
five per-program symbols stripped by upstream PROS and weakens the imported cold definitions. This lets hot objects override
cold symbols with the same precedence as GNU ld's `-R`. Loadable cold bytes stay
unchanged.

The dependency patch fixes parent-directory traversal in the WASI filesystem,
which LVGL headers need. It also prevents Vite from globbing fallback asset URLs;
the app loads compiler assets through its checked cache adapter.

The package's `objcopy` requires an unimplemented WASI filesystem operation.
`elf-binary.ts` extracts allocatable ELF32 ARM sections at their load addresses,
fills gaps with zeroes, omits `.hot_init` from the cold package, and checks each
V5 load address and memory limit. The hot package retains `.hot_init`. Its results
are compared byte for byte with native
`arm-none-eabi-objcopy`.

## Measured build times

On this machine, the EZ compile/link benchmark fell from 19.99 seconds to
3.13 seconds, a 6.4× improvement. An unchanged build took 0.33 seconds, and a
main-only source edit took 1.32 seconds. These measurements exclude compiler
startup, asset downloads, and SDK installation into the worker filesystem.

A separate pass with an empty intermediate cache for each template measured:

| Template | Compile and link |
| -------- | ---------------: |
| VEXcode  |           0.46 s |
| PROS     |           1.70 s |
| EZ       |           2.89 s |
| JAR      |           2.94 s |

Real project-route EZ builds include startup. The collaborative preview measured
8.3–8.4 seconds for the first build, 3.6 seconds after a page reload with cached
intermediates, and 0.62 seconds with a warm worker. The headless browser suite
measured 15.69 seconds first, 1.02 seconds unchanged, and 4.62 seconds after a
main-only edit following workspace formatting. The first commit formats all
workspace documents, which invalidates their objects and can disable the checked
template PCH. Header and compiler-option changes also fall back to ordinary
compilation. The 5× improvement applies to the default EZ compile/link benchmark;
first browser startup has not achieved 5× in every measured environment.

## Verification

From `apps/code`:

```sh
bun scripts/verify-browser-builds.ts
BUILD_VERIFY_EDITS=1 BUILD_VERIFY_SDK=1 bun scripts/verify-browser-builds.ts
BUILD_TEMPLATES=ez-template BUILD_PROFILE=1 bun scripts/verify-browser-builds.ts
bun test src/lib/ide
bun run typecheck
bun run build
bunx playwright test e2e/build.spec.ts --workers=1
```

The script exercises the real WebAssembly toolchain. Browser tests use the
actual project routes with real authentication and repository
operations. Hardware execution still needs a connected V5 Brain; compilation
and ELF conversion checks alone do not verify it.
