# Hardware acceptance checklist

A V5 Brain was connected on October 8, 2026. See the
[Brain results](brain/README.md) for completed checks and raw evidence.
No low-end Chromebook is available; its checks remain pending.

## Low-end Chromebook

Record model, CPU, RAM, ChromeOS/Chrome version, battery/AC state and other active
workloads. Prefer 4 GB RAM. Run the real project route with Pierre and clangd active
for VEXcode, PROS, EZ and JAR, plus a larger header-heavy multi-source project.

- Alternate the reference and optimized configurations, at least ten successful
  samples per scenario. Report median/range; collect at least twenty for p95.
- Separate fresh storage, warm assets/empty intermediates, warm worker, reload,
  offline, two-minute pause and project switching. Record exact cache state.
- Test no-op, source edit, common-header edit, README/new/deleted source, header
  rename/shadowing, include probes, forced includes and supported custom commands.
- Record artifact readiness, phase overlap, object/PCH reuse, download bytes,
  long tasks and edit-to-paint latency while compiling. Check final diagnostics,
  navigation and clangd catch-up after success, failure and cancellation.
- Measure total compiler/SDK/PCH/WASM memory and duplicated memory with two workers.
  Record failed allocations, tab discards/crashes and memory-pressure symptoms.
- Exercise storage denial/quota, eviction, two tabs, corruption, missing cold blob,
  interrupted downloads and a partially published manifest release. Check bounds.
- Compare Os/O0/O1 and project PCH on larger programs. Keep current defaults if
  latency, output size, memory or editor responsiveness regresses.
- Choose numerical latency/memory budgets from these results. CPU throttling and
  development-machine results must stay in separate datasets.

## V5 Brain

Completed Brain checks use the pinned WASM compiler, all four template SDKs,
a safe two-source task fixture and the production USB upload method. They cover
reference, optimized, O0, O1 and project-PCH outputs; PROS/EZ also cover missing,
matching and mismatched cold libraries. The fixture exercises task startup,
C++ heap allocation, cross-source linkage and build metadata without motor commands.

Remaining Brain acceptance checks follow. These are not marked passed by the safe fixture run.

- Download/restore artifacts on the real project route after reload, reset and
  eviction, then upload them through browser WebSerial.
- Run full representative robot programs, including competition callbacks,
  device I/O, motors and larger C++ workloads.
- Verify original starter-object outputs and two-worker outputs on hardware.

The original acceptance matrix is retained below for follow-up coverage.

- Verify boot header, address bounds, cold/hot symbols and PROS/EZ `.hot_init`.
- Test Brain cold-library match, mismatch and missing library. The latter two must
  upload the complete matching cold package; verify task startup and user code.
- Check fresh build timestamps and deliberate user date/time macros.
- Compare source/header/flags/optimization edits with the ordinary compile path.
  Validate runtime, ABI, C++ features and diagnostics; compilation alone is insufficient.
- Measure upload time and size for optimization/concurrency/PCH experiments.
- Verify browser outputs carry the right commit and work through the existing
  upload flow.
