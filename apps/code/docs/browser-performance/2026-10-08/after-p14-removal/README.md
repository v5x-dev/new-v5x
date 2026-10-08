# Browser builds after P14 removal

October 8, 2026. P14 was removed. The project route compiles locally; compiler
reset and cancellation remain. The preexisting backend build pipeline was retained.

328 successful builds on the real `/p/:programId` route with Pierre and clangd
active. Four templates each ran alternating reference/optimized builds on identical
snapshots: one initial pair, 20 no-op pairs and 20 one-source-comment-edit pairs.
Two partial EZ captures were stopped after browser navigation or generated-report
reloads invalidated or threatened measurement. The completed fresh rerun is
included. Generated test output was moved outside the app and the HTML reporter
disabled to avoid dev-server reloads.

One Playwright worker ran at a time; no compiler experiments, packaging or other
benchmark builds ran concurrently. Other desktop processes remained active.

Intel i7-8700K, 32 GB RAM, Linux, Chromium. See raw reports for exact user agent.
These are development-machine measurements, not Chromebook results.

The reference is current code with fresh sessions, caches, PCH, starter objects
and prebuilt cold output disabled, and timestamp metadata compiled. It is not a
historical pre-change checkout. The comparisons measure the combined local
optimizations; they do not show a speedup caused by removing P14.

## Warm comparisons

| Template     | Scenario                | Reference median ms | Optimized median ms | Reference p95 ms | Optimized p95 ms |
| ------------ | ----------------------- | ------------------: | ------------------: | ---------------: | ---------------: |
| vexcode      | warm-noop               |                 439 |                 165 |              484 |              218 |
| vexcode      | one-source-comment-edit |                 401 |                 391 |              459 |              420 |
| pros         | warm-noop               |                2164 |                 307 |             2295 |              392 |
| pros         | one-source-comment-edit |                2137 |                1329 |             2276 |             1442 |
| ez-template  | warm-noop               |                8965 |                 448 |             9570 |              575 |
| ez-template  | one-source-comment-edit |                8994 |                4008 |             9189 |             4167 |
| jar-template | warm-noop               |                3510 |                 209 |             3638 |              254 |
| jar-template | one-source-comment-edit |                3440 |                 705 |             3504 |              795 |

Each cell uses 20 successful samples. p95 uses the nearest-rank method. Range and
individual samples are in the raw JSON and the [interactive report](report.html).
Static charts are available for [warm no-op builds](warm-noop.png) and
[source-edit builds](source-edit.png).

Time runs from automation initiating the build click to worker result and UI
success checks. Polling uses a 20 ms interval; click/actionability and UI automation
overhead remain in these values. Commit/edit time is reported separately and
excluded from build latency. Captured phase spans use the compiler worker clock;
client request-to-artifact spans are not captured by worker interception.
Automation wall time and phase timelines remain separate. Overlaps are retained.

The fresh browser context and initial compiler Cache Storage clear do not make
the first pair a fair cold comparison: reference runs first, fetches assets and
initializes the compiler, while optimized runs afterward. Initial pairs remain in
the raw data but are excluded from warm medians/p95. Language preloading and
persistent/intermediate cache state differ from the earlier manual captures.

This run uses the benchmark suite, not the earlier 200 ms completion-polling
capture. Do not attribute differences between old and new reports solely to code.

No CPU throttling, interactive typing-during-build metric, peak WASM memory or
Brain upload time is included. Defaults remain Os and one compiler worker.

## Reproduction

Start the real app on port 3001, then run from `apps/code`:

```sh
BUILD_BROWSER_BENCH=1 BUILD_BROWSER_VARIANTS=reference,optimized \
  BUILD_BROWSER_SAMPLES=20 BUILD_BROWSER_ROUTES=project \
  PLAYWRIGHT_BASE_URL=http://localhost:3001 \
  bunx playwright test e2e/browser-performance.spec.ts --workers=1 \
    --reporter=list --output=../../.build/post-p14-test-results
```

Raw reports contain fixture digests, device details, timing spans, long tasks,
commit times, per-scenario summaries and all successful samples. No source,
credentials or project IDs are included.

Validation passed 71 IDE tests, changed production-code lint, typecheck and
production build. The real project build-options menu had no cloud choice and
retained compiler reset. Local build cancellation and retry passed on the real
project route after P14 removal.
