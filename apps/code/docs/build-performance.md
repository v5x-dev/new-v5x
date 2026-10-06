# Cloud build performance

Measured on the development Convex deployment on October 6, 2026. The original
cloud pipeline and optimized pipeline used the same direct Convex HTTP client,
five successive edits to a live delay instruction per template, and native x86
Smol cloud workers. Each sample starts immediately before the build action call
and ends after the action returns stored artifact URLs. Repository commits and
subsequent artifact downloads are outside the timer. CLI startup is excluded.

| Template | Original median | Optimized median | Optimized range | Reduction |
| -------- | --------------: | ---------------: | --------------: | --------: |
| VEXcode  |         1651 ms |           864 ms |      832–964 ms |       48% |
| PROS     |         2403 ms |          1353 ms |    1136–1412 ms |       44% |
| EZ       |         3788 ms |          3006 ms |    2338–3118 ms |       21% |
| JAR      |         2234 ms |           954 ms |     932–1008 ms |       57% |

These are warm single-file edits, not cold starts or arbitrary large programs.
The initial sample is retained in the reports but excluded from these medians.
The raw timing samples are in [baseline](build-performance/direct-baseline.json)
and [optimized](build-performance/direct-final.json). These measurements preceded
a correctness fix that invalidates objects on header changes. Source-only edits
still use the same path.

## Changes

The coordinator runs in Convex's default runtime and calls the cloud machine HTTP
API directly. It avoids starting a Node process and loading the native machine
SDK for each build. Compilation still happens on cloud workers.

Known commits use one bounded Git smart HTTP request. The action sends the pack
to the worker, installs real Git objects, and checks out the exact commit. Large
packs or unsupported responses use ordinary Git. Synchronization and compilation
share one execution request. Warm workers retain object files and toolchains.

Unchanged VEXcode and JAR build configurations use a Clang precompiled header.
An exact configuration fingerprint gates the rule overlay, and only sources
starting with the normal umbrella include consume it. PROS and EZ retain GCC.
Header edits invalidate objects and precompiled headers; configuration changes
invalidate build outputs. Edited builds always relink, including source deletions.

Small binaries travel inside the execution response, within a 256 KiB total
budget. Larger binaries use the binary file API. SHA-256 and size checks protect
artifact transfers, and storage metadata is verified before caching. Unchanged
artifacts, including PROS/EZ cold packages, reuse their stored blobs.

## Verification

All four templates passed live cloud checks for header-only changes, deleted
headers, added and deleted sources, build flag changes, compiler failures, and
recovery. VEXcode also passed a repository pack above the fast transport limit.
There were 45 checks in total. A separate PROS check deleted the cached worker
and verified a successful clean fallback with downloadable artifacts. That
fallback required roughly two seconds to start the worker and 3.5 seconds to
compile, plus transport and storage overhead.

The actual `/p/:programId` app route passed an edit, commit, and cloud build with
Pierre and C++ language support active. Transport and worker ownership tests
passed, as did the application typecheck.

## Reproduce

From `apps/code`, run with `PIERRE_PRIVATE_KEY`, `VITE_CONVEX_URL`, and a development
`CONVEX_DEPLOY_KEY` in the environment:

```sh
BUILD_BENCH_SAMPLES=5 bun scripts/benchmark-round-trip.ts comparison
bun scripts/verify-cloud-builds.ts
```

The scripts create synthetic repositories/programs and cloud workers. Results go
under `.build/cloud-round-trip` at the repository root. Set
`BUILD_BENCH_TEMPLATES=vexcode,pros,ez-template,jar-template` to select benchmark
templates. Without a deploy key, the scripts use the logged-in Convex CLI and
include its startup overhead. Compare only runs using the same measurement mode.
Keep credentials out of reports and clean up synthetic workers after experiments.
