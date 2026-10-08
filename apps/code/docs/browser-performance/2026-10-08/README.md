# October 8 local results

Intel i7-8700K development machine, 32 GB RAM, Linux, Chromium 154. These are
local results, not low-end Chromebook measurements. Raw JSON contains no source,
credentials or project IDs. Ten observations per variant are insufficient for p95.

## Real application routes

100 successful alternating builds. The reference is the current implementation
with fresh sessions, caches/PCH/starter/prebuilt-cold reuse disabled and metadata
compiled. It is not a historical checkout. Assets were already warm, intermediate
caches were not cleared between samples, and initial template samples include
startup. Ordering reverses each pair. Do not interpret these comparisons as an
isolated measurement of any single optimization.

The demo uses UI completion polling every 50 ms with a 200 ms minimum. That floor
limits interpretation of fast VEX/JAR results. The project uses worker-result
polling every 50 ms with Pierre and clangd active. No compiler experiment or build
process ran concurrently. A second tab briefly loaded the app home and created a
fixture during the demo dataset; no second compiler ran. Interrupted HMR runs were
discarded and only completed captures are included.

| Route         | Template     | Reference median ms | Optimized median ms | Samples |
| ------------- | ------------ | ------------------: | ------------------: | ------: |
| /build-demo   | ez-template  |                8499 |                 403 | 10 + 10 |
| /build-demo   | jar-template |                3260 |                 200 | 10 + 10 |
| /build-demo   | pros         |                1991 |                 250 | 10 + 10 |
| /build-demo   | vexcode      |                 301 |                 200 | 10 + 10 |
| /p/:programId | pros         |                2100 |                 220 | 10 + 10 |

pros: compiler timestamp 37.95 ms; object patch 0.08 ms, ten spans each.

ez-template: compiler timestamp 28.67 ms; object patch 0.05 ms, ten spans each.

PROS project result restored from IndexedDB after reload. The new build-options
menu was checked on the actual route. Chromium IndexedDB checks passed concurrent
writes, shared cold-blob storage, owned bytes, corruption misses, repair, legacy reads and the 32-build bound.
Earlier all-template project/edit/offline/cancel/recovery reports remain in the
October 7 directory. These paired datasets cover unchanged snapshots only.

## Bun-hosted compiler experiments

160 complete compile/link runs plus 40 driver dry-runs. Each template adds eight
independent umbrella-header sources. No object cache or starter objects; project
PCH persists within its variant. Each variant has ten samples, run in blocks, so
thermal/order effects are uncontrolled. These exclude browser startup, editor,
network and upload. PCH creation cost appears in the first sample and is not
represented by the warm median alone.

| Template     | Os ms | O0 ms | O1 ms | Project PCH ms | Driver dry-run ms |
| ------------ | ----: | ----: | ----: | -------------: | ----------------: |
| ez-template  | 27793 | 30318 | 27726 |           6500 |                14 |
| jar-template |  5802 |  5726 |  5730 |           1320 |                10 |
| pros         |  8069 |  7946 |  7904 |           2496 |                12 |
| vexcode      |  1411 |  1359 |  1361 |            453 |                11 |

Keep Os and one worker as defaults. O0/O1 do not consistently win, and runtime
behavior now has safe task-fixture coverage on a Brain; full robot behavior remains
pending. PCH helps this repetitive fixture but
peak WASM/PCH memory is unavailable, so project PCH stays experimental. Parallel
compilation has implementation/failure coverage; no performance promotion is
justified without device memory and interaction measurements.

The toolchain audit reports only ARM/ARM big-endian/Thumb/Thumb big-endian targets.
The primary WASM is 63,386,658 bytes; three required adapter modules are 37,626,
5,458 and 787 bytes. The loader already memoizes module/resource promises and uses
streaming compilation when MIME permits. No backend-removal fork or direct-cc1
shortcut shipped. Upstream utility stripping needs a supported compatibility case.

Indexed binary packaging reduces decompressed VEX/ARM/PROS/EZ bundles by about
25% and compressed bytes by about 27%. Language header JSON remains compatible.
No browser peak-memory or decompression-time speedup is inferred from byte sizes.

## Reproduction and pending acceptance

Use the commands in [implementation status](../../browser-build-performance-status.md).
The paired JSON reports record route/cache/clock details and phase spans. The
self-contained report HTML is generated from these raw files. Counts and phase
timelines are explanatory; overlapping spans must not be added together.

[Brain USB upload and runtime results](brain/README.md) now cover four template
SDKs and five build variants with safe task fixtures, plus cold-library reuse and
replacement. [Remaining hardware and live-service checks](hardware-checks.md)
include full robot behavior, browser WebSerial, Chromebook memory/typing, parallel
latency-versus-memory, cold-installation paired runs and cloud end-to-end
measurements. Missing measurements are not zero.

## After P14 removal

P14's route option and integration additions were removed at the user's request.
The earlier cloud observations above describe the previous implementation.
See [the new paired project benchmarks](after-p14-removal/README.md) for the
current local build configuration and separate no-op/source-edit results.
