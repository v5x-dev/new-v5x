# Development browser measurements

October 7, 2026, on an Intel Core i7-8700K desktop with 32 GB RAM and Linux
7.2.5-3-omarchy. Playwright Chromium 153 used its Desktop Chrome preset. That
preset advertises a Windows user agent; the host runs Linux. Power state was not
recorded. Other desktop applications and another Vite server were active. This
is not a Chromebook measurement or calibrated CPU throttling.

These are post-change samples, without an alternating pre-change baseline. No
speedup percentage can be derived from them. Tracing was enabled. Initial site
cache state was unspecified; those samples are not cold-installation baselines.
The routes are the real `/build-demo` and authenticated `/p/:programId` pages.
Pierre and clangd were active on the project route.

| Template | Route   | No-op median, ms | Comment-edit build median, ms | Successful samples, no-op / edit |
| -------- | ------- | ---------------: | ----------------------------: | -------------------------------: |
| VEXcode  | demo    |               83 |                           368 |                          10 / 10 |
| VEXcode  | project |              126 |                           462 |                          10 / 10 |
| PROS     | demo    |              257 |                          1378 |                          10 / 10 |
| PROS     | project |              440 |                          1975 |                          10 / 10 |
| EZ       | demo    |              389 |                          1595 |                          10 / 10 |
| EZ       | project |              507 |                          5089 |                          10 / 10 |
| JAR      | demo    |               98 |                          1024 |                          10 / 10 |
| JAR      | project |              178 |                          1045 |                          10 / 10 |

Each JSON file contains the raw worker spans, automation wall times, summary,
fixture digest, browser signals, and long-task durations. `environment.json`
records shared limitations. Medians for even sample counts average the two
central values. p95 is deliberately null for these ten-sample scenarios.
Automation polling and rendering are included in wall time; worker spans use a
separate clock domain. Overlapping spans must not be summed.

The source-edit scenario appends comments. It measures recompilation after a
content change, not a changed robot workload. `commitMs` includes editing and
formatting/commit preparation, outside the build timer. No Brain upload, actual
robot runtime, total browser/WASM peak memory, or controlled pause/offline
performance dataset was collected.

JAR's first formatted commit exposed an existing include-order bug. The formatter
fallback now preserves include order; project style files still take precedence.
The stored JAR project dataset is the successful rerun after that fix. Failed
benchmark-development attempts and the earlier formatter failure are excluded
from this dataset, not presented as successful samples.

EZ's first commit changes header bytes and disables the packaged PCH. Its first
comment-edit sample includes recompilation of all affected objects. Later edits
reuse the unchanged object. This explains why project and demo edit timings
cannot be treated as the same PCH scenario.

Reproduce from `apps/code` with an application server and working authentication:

```sh
BUILD_BROWSER_BENCH=1 PLAYWRIGHT_BASE_URL=http://localhost:3001 \
  bunx playwright test e2e/browser-performance.spec.ts --workers=1
```

Set `BUILD_BROWSER_DEVICE` to the actual device/CPU/RAM/OS/power description for
future runs. Raw output goes to `.build/browser-performance`. Run a quiet machine,
restore documented cache states, and add alternating reference runs before making
comparative performance claims.
