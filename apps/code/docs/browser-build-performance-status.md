# Browser build performance implementation status

Updated October 8, 2026. The implementation covers P0–P13, with experimental
choices kept behind internal switches. The connected V5 Brain has been used for
USB upload and runtime checks. Low-end Chromebook acceptance remains pending.
P14 was removed at the user's request. See the hardware report for the exact scope.

## Implementation and decisions

| Package | Delivered behavior and decision                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0      | Optional build-ID spans for startup, assets, synchronization, dependency checks, compile/PCH/metadata, link/package, cache reads/persistence and artifact readiness. Real-route benchmark tooling alternates configurations on the same snapshot. Reports distinguish clock domains and overlapping phases.                                                                                                                          |
| P1      | One retained worker/session per active workspace, ordered SDK overlays, changed-file writes, deleted override restoration, serialized immutable snapshots, cancellation/reset/error disposal. Unsafe custom commands use a fresh session.                                                                                                                                                                                            |
| P2      | Memoized content identities, normalized bounded depfiles and validated cache records. Ordinary source/Markdown additions preserve reuse where includes allow it. Computed includes and uncertain custom commands remain conservative.                                                                                                                                                                                                |
| P3      | Checked SDK-prefix PCH for all four templates plus opt-in project PCH for shared umbrella headers in all templates. Configuration, include inventory and dependency identities gate reuse. Failure retries ordinary compilation. Project PCH stays experimental pending memory measurements.                                                                                                                                                                        |
| P4      | Pinned PROS/EZ cold binary and import-symbol assets with effective firmware/compiler validation. Overrides and unavailable/corrupt assets retain dynamic linking. Linker normalization writes scratch, preserving the mounted SDK.                                                                                                                                                                                                   |
| P5      | A 1,044-byte validated ARM ELF timestamp object. Patch fresh UTC date/epoch in owned bytes, validate symbols/relocations/bounds, and fall back to Clang for incompatible objects or unrepresentable epochs.                                                                                                                                                                                                                          |
| P6      | Validated VEX/JAR completed-output reuse; PROS/EZ regenerate metadata and hot link. Cold transfer references require a client ownership acknowledgement. IndexedDB separates digest-addressed blobs from result records, retains legacy reads, verifies restored bytes and bounds storage.                                                                                                                                           |
| P7      | Immediate bounded memory publication, ordered asynchronous persistence, batch eviction, integrity checks and storage-failure misses. Caps are 32 MiB memory, 16 MiB pending, 128 MiB persistent and 128 entries. Persistent hits refresh insertion order through the bounded queue; memory reads use LRU. These limits still need device tuning.                                                                                     |
| P8      | Versioned bounded indexed binary SDK archives, old-format compatibility, coherent manifest pinning and idle update discovery, immutable asset headers, checked asset reuse, conservative selected-project preload and explicit reset. Language header bundles retain their compatible JSON format. The loader already memoizes modules and uses streaming compilation with correct MIME; no unchecked streaming path was introduced. |
| P9      | Ordered 75 ms/64 KiB output batches with exit flushing, cancel/retry UI, deferred/coalesced clangd changes and explicit-request flushing. Pierre remains the editor.                                                                                                                                                                                                                                                                 |
| P10     | Internal O0/O1/Os comparisons with effective explicit project flags preserved in configuration identity. No consistent local benefit justified a new setting or default. Keep Os. Safe task fixtures now run on VEXos 1.1.5; full robot behavior remains a hardware check.                                                                                                                                                           |
| P11     | Opt-in two independent worker/filesystem sessions, cache misses only, stable object ordering, teardown and sequential fallback after failure. One remains default. No target-device memory evidence supports enabling two.                                                                                                                                                                                                           |
| P12     | Verified starter objects for all four templates, compiled with the pinned compiler and full argument/dependency/include metadata. Fetch lazily only after eligibility checks. Edits and configuration changes use ordinary compilation.                                                                                                                                                                                              |
| P13     | Toolchain/import/target audit and driver measurements. The pinned toolchain is already ARM-only. Do not fork merely to remove backends that are absent. Standard frontend plans now come from the pinned driver's own -### output. They require exact argument matching and pass original-compiler equivalence checks. Custom flags retain the full driver. Binaryen 133 produces a verified alternate core. EZ browser builds use it, while VEX/PROS/JAR retain the original after Chromium measurements. Bun tooling uses the alternate core.                                                                                                                                                                      |
| P14     | Removed at the user's request. The project route builds locally; the earlier backend pipeline remains available to existing tooling.                                                                                                                                                                                                                                                                                                 |

## Local evidence

The full real WASM verification covers all four templates with retained sessions,
source/header edits, additions/deletions, errors/recovery, SDK headers and custom
flags. Packaged PROS/EZ cold binaries match dynamic references. Native objcopy and
ELF checks run where the existing tooling supports them.

The remaining IDE suite passes 71 tests. P14's cloud adapter and four Convex
request tests were removed with the feature. Typechecking,
production compilation and changed production-code lint pass. All 24 SDK manifest
assets match their declared sizes and SHA-256 digests.

The IDE tests cover cache bounds/failures, ownership, request serialization,
dependency/include invalidation, archive corruption, metadata validation,
clangd scheduling and parallel-worker failure.

A real Chromium `/build-demo` check verifies IndexedDB concurrent writes,
deduplicated cold blobs, caller-byte ownership, corruption misses and repair.
Earlier real `/p/:programId` integration checks cover cancellation/retry, offline
rebuild and worker/PCH recovery. Those earlier results are preserved separately;
they are not a substitute for hardware acceptance.

After P14 removal, 328 successful alternating builds cover all four templates on
`/p/:programId`, with 20 no-op and 20 source-edit samples per variant. The
[updated report](browser-performance/2026-10-08/after-p14-removal/README.md) includes
medians, p95, ranges, individual samples and representative phase timelines.
Local cancellation and retry passed on the real route. Interrupted development
server captures were discarded and rerun.

See [October 7 browser results](browser-performance/2026-10-07/README.md) and
[October 8 experiments](browser-performance/2026-10-08/README.md). Development
server reloads invalidate a benchmark; interrupted samples are discarded.

## Reproduction

From `apps/code`:

```sh
bun run prepare:build-assets
bun run typecheck
bun test src/lib/ide tests
BUILD_VERIFY_EDITS=1 BUILD_VERIFY_SDK=1 BUILD_PROFILE=1 bun scripts/verify-browser-builds.ts
bun run build
BUILD_BROWSER_BENCH=1 BUILD_BROWSER_VARIANTS=reference,optimized \
  PLAYWRIGHT_BASE_URL=http://localhost:3001 \
  bunx playwright test e2e/browser-performance.spec.ts --workers=1 \
    --reporter=list --output=../../.build/browser-performance-test-results
bun scripts/benchmark-browser-experiments.ts
bun scripts/inspect-browser-toolchain.ts
```

Preparation publishes content-addressed assets before the SDK manifest. Deploy
compiler/header/library/PCH/cold/starter manifests and assets together. Keep old
assets during rollout. Optional optimizations fall back safely; an incompatible
compiler generation requires a new worker. Do not run benchmarks concurrently
with packaging, compiler experiments, production builds or app edits.

The reference switch is the current implementation with fresh sessions, caches,
PCH, starter objects and packaged cold outputs disabled, and metadata compiled.
It is not a historical pre-change checkout. Bun-hosted timings exclude browser
startup, Pierre/clangd contention, network and Brain upload.

## Remaining acceptance checks

Use [the hardware checklist](browser-performance/2026-10-08/hardware-checks.md).
No Chromebook latency/memory budget or guaranteed speedup is claimed. Total WASM
peak memory is unavailable in the local reports. Browser heap estimates cannot
stand in for it. Project PCH, optimization modes and two-worker compilation remain
internal experiments until device evidence supports a product/default change.

Persistent multi-tab eviction under quota pressure, partial-release
upgrades, all-route paired comparisons and interaction tails remain broader
acceptance runs; use the supplied matrix and benchmark tooling and record failures.

## October 10 compilation pass

See [measurements and graphs](browser-performance/2026-10-10/report.md) for fresh
workspaces and actual source/header edits with starter reuse disabled. This pass
adds geometric filesystem writes, SDK-prefix PCH across all templates,
driver-generated frontend plans, integrity-gated WASM streaming, concurrent
startup assets and compressed compiler resources. The main WASM module is
optimized with verified Binaryen 133 and published under a content-addressed URL.

Development serves prepared compiler compression and gzip SDK bundles directly
to avoid Nitro recompressing them. Compiled WASM modules are keyed by immutable
asset identity, with two cached variants. A real-route test switches VEX, EZ and
VEX within one worker and checks that both cores load correctly.

The follow-up [one-line edit pass](browser-performance/2026-10-10/one-line-edits/report.md)
adds bounded string-hash reuse and aggregate dependency identities that invalidate
on input changes. PROS, EZ and JAR now instantiate pending SDK templates during
PCH preparation instead of repeating that work in every affected translation unit.
VEX retains its previous PCH configuration. The report records real source and
header edits, compiler-variant trials, and generated-code equivalence checks.
