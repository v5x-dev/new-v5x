# One-line edit optimization, second pass

October 10, 2026. Intel Core i7-8700K, 32 GB RAM, Linux x64, Bun 1.4.2 and Chromium 153. This pass builds on the [earlier compiler and startup work](../report.md). Measurements apply to this host and the supplied projects; they cannot establish a physical lower bound.

[Interactive graphs](graphs.html) · [Source-edit SVG](source-edit.svg) · [Header-edit SVG](header-edit.svg) · [Measured values and ranges](summary.json)

## Changes retained

The largest additional improvement comes from generating the PROS, EZ and JAR SDK prefix PCH with Clang's `-fpch-instantiate-templates`. Pending SDK template instantiations finish during asset preparation instead of repeating in each edited translation unit. VEX retains its previous generation flags because its experiment showed no improvement. Consuming compiler arguments and firmware optimization levels are unchanged. Generation flags enter the asset provenance signature, forcing regeneration of the affected assets.

Dependency checking also avoids redundant work. Short immutable string hashes are reused in a bounded cache; mutable file bytes are copied and hashed again. Aggregate dependency digests are retained only while every file keeps the same identity. Writes, deletions, restored overlays and compiler outputs invalidate those identities. Identical SDK prefix contents no longer cause unnecessary writes. Missing dependencies and time macros still prevent reuse. Aggregate retention is bounded to 64 entries and an estimated 2 MiB; string retention is bounded to 4096 entries of at most 512 characters. Cache-key encoding remains compatible.

The hash-only stage reduced median source-edit dependency validation from 1.09 to 0.16 ms for VEX, 3.25 to 0.39 ms for PROS, 9.89 to 0.55 ms for EZ and 13.17 to 0.34 ms for JAR. Raw staged measurements are preserved.

## Method and results

The before measurement already includes the first pass. Both sides run the actual `/build-demo` route, editor, Build button, worker and artifact download, with five samples per template. A source edit changes one delay instruction. A header edit changes a macro consumed by the source without changing that source. Tests require a compile span and changed firmware; native measurements additionally require a changed main-object digest. Starter-object reuse is disabled. Unchanged builds are separate controls, excluded from edit charts.

Worker totals include input synchronization, dependency checking, compilation, linking and packaging. Browser wall times also include Playwright interaction and polling. The first fresh sample clears application asset and object caches; subsequent fresh samples restart the worker and clear objects while retaining downloaded assets. These are local-server measurements, not fully cold browser or network measurements. Trials run sequentially, so small differences can reflect JIT and machine variation.

Median worker milliseconds; lower is better. Five samples per cell.

| Template | Edit | Before ms | After ms | Reduction |
| --- | --- | ---: | ---: | ---: |
| VEXcode | Source | 95 | 89 | 6.7% |
| VEXcode | Header | 72 | 76 | 6.4% slower |
| PROS | Source | 331 | 122 | 63.0% |
| PROS | Header | 269 | 104 | 61.4% |
| EZ | Source | 947 | 713 | 24.7% |
| EZ | Header | 1395 | 919 | 34.1% |
| JAR | Source | 142 | 122 | 14.4% |
| JAR | Header | 733 | 650 | 11.4% |

VEX differences are small and overlap the observed variation; its header median increased by about 5 ms. The strongest gains are PROS and EZ. Sample ranges and individual phase timings are available in the linked summary and raw records.


Compiler-only Bun medians below exclude initialization, mounting, network and UI. Seven after samples; raw files preserve before sample counts and ranges. Bun uses the optimized core for every template, so these numbers should not be compared directly with browser totals.

| Template | Edit | Before ms | After ms |
| --- | --- | ---: | ---: |
| VEXcode | Source | 62 | 60 |
| VEXcode | Header | 62 | 58 |
| PROS | Source | 206 | 88 |
| PROS | Header | 204 | 92 |
| EZ | Source | 705 | 507 |
| EZ | Header | 1179 | 751 |
| JAR | Source | 102 | 79 |
| JAR | Header | 552 | 481 |

## Experiments

| Trial | Outcome |
| --- | --- |
| Eager SDK template instantiation | Retained for PROS, EZ and JAR; VEX kept its previous PCH flags. |
| Synchronous WASM instance construction | No consistent gain; browser linking regressed. |
| Retaining the Clang AST through backend work | Generally slower. |
| Disabling PCH validation | Tiny or inconsistent gains; validation retained. |
| Snapshotting the runtime debug flag | Mixed native and browser results; unchanged production runtime. |
| Binaryen `-O2`, `-Os`, `-Oz` compiler cores | Retested PROS and EZ after eager PCH. Slight EZ source gains came with flat/slower headers; PROS headers improved but source edits regressed. Current selection retained. |

The browser keeps the original core for VEX, PROS and JAR and Binaryen `-O3` for EZ. Bun benchmarks use `-O3` for every template. These optimize the compiler's own WASM without lowering firmware optimization levels. Trial samples and core hashes are included for reproduction. An Oz browser trial encountered a Vite `socket hang up` overlay during page loading; the failed case was rerun and no failed sample entered the results.

Compressed PCH payloads are now 5,544,576 bytes for PROS, 14,097,597 for EZ and 2,664,937 for JAR. VEX remains 1,069,897 bytes. This trades one-time download and mounting work for less repeated compilation. Earlier PROS and EZ payloads were approximately 5.24 MB and 13.69 MB.

## Correctness and limits

Generated code, data, symbols and relocations match the original full-driver, no-PCH compiler for six configurations on each of the four templates. Real WASM verification also covers changed headers, SDK overrides, added/deleted files, compiler errors and recovery, custom flags, native objcopy and cold firmware equivalence. 68 unit tests with 280 assertions passed, including mutable-buffer hashing and dependency invalidation. The final browser suite passed all five tests, with a separate authenticated-route check. Typecheck, changed-code lint, formatting and the production build pass. The authenticated `/p/:programId` route builds, exposes its artifact and restores it after reload.

These checks establish agreement on the fixtures, not compiler equivalence for arbitrary C++. Physical Brain execution was not performed in this pass. Larger projects, different devices and network conditions may favor different choices. Further compiler-source work, such as PCH code generation, could improve some workloads but needs separate validation of inlining, emitted objects and global initialization. A claim that no further optimization is physically possible would be unsupported.

## Reproduce

From the repository root:

```sh
bun apps/code/scripts/prepare-sdk-pch.ts
BUILD_BENCH_SAMPLES=7 bun apps/code/scripts/benchmark-compiler-edits.ts edit-pass-after
BUILD_VERIFY_COMPILER_PLANS=1 BUILD_VERIFY_EDITS=1 BUILD_VERIFY_SDK=1 bun apps/code/scripts/verify-browser-builds.ts
bun apps/code/scripts/report-compiler-edit-pass.ts
```

Run the browser workload from `apps/code` against the actual development server:

```sh
BUILD_COMPILER_EDITS=1 BUILD_BENCH_SAMPLES=5 BUILD_BENCH_LABEL=edit-pass/browser-after PLAYWRIGHT_BASE_URL=http://localhost:3001 bunx playwright test e2e/compiler-edits.spec.ts --workers=1 --reporter=list
```

Set `BUILD_BROWSER_WASM` to an absolute candidate core path to repeat a compiler trial. `BUILD_PCH_DIR` and `SDK_PCH_EXPERIMENT_DIR` support raw PCH experiments without publishing a different SDK manifest. Candidate provenance records Binaryen version, flags, pinned input hash and output hash.
