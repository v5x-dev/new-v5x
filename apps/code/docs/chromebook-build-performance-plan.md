# Chromebook browser build performance plan

Status: implementation and local experiments delivered October 8, 2026. See
[implementation status](browser-build-performance-status.md) for package decisions,
local evidence and remaining acceptance runs. A connected V5 Brain now supports
[hardware checks](browser-performance/2026-10-08/hardware-checks.md). Chromebook
measurements remain pending. P14 was removed at the user's request. Experimental
options stay disabled by default.

## Objective and scope

Make robot program compilation through browser WebAssembly Clang and LLD in
`apps/code` practical on inexpensive Chromebooks. Optimize the loop of editing,
committing, building, and uploading, including the time students spend thinking
between edits. Preserve successful program behavior, diagnostics, supported
project configuration, offline rebuilds, and the V5 binary format.

This concerns C/C++/assembly program builds, not Vite or the production build of
the web application. Support all four templates: VEXcode, PROS, EZ Template, and
JAR Template. Keep local compilation usable independently of any optional remote
build service.

The implementation should address all of these costs:

- First download and compiler startup.
- Repeated SDK filesystem setup and project file writes.
- Header parsing, dependency validation, and object compilation.
- SDK linking, user linking, metadata generation, and binary conversion.
- Cache reads, writes, eviction, artifact copying, and transfer.
- Competition with clangd and UI work, plus peak memory use.
- Warm state lost during pauses, navigation, reloads, or cancellation.

## Rules for implementing agents

- Read applicable `AGENTS.md` instructions. Use bun and bunx for JavaScript tools.
- Keep `@pierre/diffs` as the editor. Consult its APIs before adding editor behavior.
  Read the diffs skill if changes involve Pierre and the trees skill if changes
  involve the file tree. Use the shadcn skill and existing components for UI work.
- Use real application routes for verification. `/build-demo` exercises the shared
  compiler path, but `/p/:programId` is required to measure editor, clangd, commit,
  artifact, and upload integration. An isolated editor page cannot replace it.
- Prefer the T3 collaborative preview for interactive browser verification.
  Start with `preview_status`, then `preview_open` if needed.
- Before changing Convex code, read `apps/code/convex/_generated/ai/guidelines.md`.
- Format changed handwritten files with the relevant formatter. Exclude generated
  assets and build output. Avoid unrelated formatting changes.
- Preserve the current ARM ABI fixes, linker behavior, and address checks described
  in `browser-builds.md`. A faster binary that crashes on the Brain is a regression.
- Treat generated assets, SDK provenance, licenses, and manifest updates as one
  release unit. Do not accidentally commit temporary benchmark assets.
- Do not log source contents, credentials, or private project identifiers in
  performance reports. Use synthetic fixtures and stable anonymized run IDs.

## Existing behavior and evidence

Read these before implementation:

- `apps/code/docs/browser-builds.md`: local architecture, ABI fixes, packaging,
  offline limitations, and existing measurements.
- `apps/code/docs/build-performance.md`: cloud measurements. These measure another
  execution path and must not be combined with browser results.
- `apps/code/src/lib/ide/build-client.ts`: worker lifecycle and stored results.
- `apps/code/src/lib/ide/build.worker.ts`: asset loading and SDK installation.
- `apps/code/src/lib/ide/browser-build.ts`: compile commands, caches, PCH, linking.
- `apps/code/src/lib/ide/build-cache.ts` and `build-assets.ts`: persistence and assets.
- `apps/code/src/lib/ide/compile-commands.ts` and `elf-binary.ts`: ABI and binaries.
- `apps/code/scripts/prepare-ez-pch.ts`, `scripts/prepare-browser-compiler.ts`,
  `scripts/package-build-sdk.py`, and `scripts/install-vex-build-assets.py`.
- Existing browser build tests, verification scripts, and real-route e2e tests.
  `apps/code/scripts/benchmark-builds.ts` benchmarks cloud machines, so it is not a
  substitute for a browser benchmark.

Current local code retains an idle worker, caches decoded SDK entries, checks
compiler depfiles before reusing objects, caches a cold SDK ELF, and supports a
checked EZ PCH. The plan makes these existing mechanisms more effective.

Recent exploratory end-to-end samples had warm assets and no object reuse:

| Template     | Normal | With 31 competing browser workers | Artifact bytes |
| ------------ | -----: | --------------------------------: | -------------: |
| VEXcode      |  4.7 s |                             7.7 s |         16,408 |
| PROS         |  3.4 s |                            14.1 s |      1,364,384 |
| EZ Template  |  6.1 s |                            25.3 s |      2,414,492 |
| JAR Template |  4.5 s |                            17.0 s |         32,796 |

These are single exploratory samples. Competing workers are CPU contention, not
a calibrated 4× CPU slowdown or a Chromebook simulation. An unchanged JAR rebuild
took 0.2 s, reused seven objects, and invoked Clang zero times. An initial EZ asset
load plus build took about 35 s. These observations justify investigating repeated
work; they do not establish which phase dominates on a Chromebook.

Do not promise numerical speedups from this table. Establish new baselines with
phase measurements, repeated samples, and real hardware.

## Shared design and correctness contract

Agree on these contracts before parallel implementation. Keep interfaces small;
extend existing modules rather than introducing another build engine.

### Build identity

Keep distinct identities for:

1. Compiler and runtime version, including dependency patches and cache schema.
2. SDK manifest generation, ordered overlays, target ABI, and actual effective SDK
   inputs. Workspace files can override firmware files mounted by SDK bundles.
3. Workspace ownership. `BrowserBuildInput` currently has no workspace ID; add an
   explicit identity if session reuse needs it. A commit SHA alone is insufficient.
4. Compile command, preprocessing configuration, and dependency contents.
5. Link command, ordered object inputs, actual libraries, and linker scripts.
6. Build metadata policy, including timestamps and development/optimized mode.
7. Source snapshot and commit provenance associated with the returned artifacts.

Use canonical serialization and content digests. Include the schema version in
keys. Never use filesystem modification time as the sole correctness check.

### Include resolution

Depfiles describe files used by the previous compilation. They do not describe
missing include candidates. A newly added header earlier in an include search
path, or a change to `__has_include`, can change compilation while all old
dependencies remain byte-identical.

Replace broad file-list invalidation only with a rule that handles this. A
conservative first version can invalidate objects on relevant include inventory
changes while allowing unrelated README and source additions. Handle forced
includes, assembly includes, directory-relative lookup, custom include flags,
and unknown file extensions conservatively. PCH and starter-object reuse need
the same protection. Document the supported model and its conservative fallbacks.

### Snapshot and ownership

- Every build consumes an immutable source/configuration snapshot.
- Serialize builds for a shared session. Use build IDs and a session generation
  to prevent cancelled, obsolete, or cross-project results from reaching the UI.
- Editing during compilation must not mutate the compiling filesystem.
- Artifact arrays must remain valid after transferable buffers are posted. Keep
  cached bytes separately or create the transferable copy at the ownership boundary.
- Persistent caches are optional acceleration. Missing, corrupt, unavailable, or
  quota-limited caches must fall back to correct compilation.
- A failed build must never expose successful artifacts from an earlier snapshot
  as the result of the failure.

### ABI and binary requirements

Preserve Cortex-A9 target flags, float ABI, GCC-compatible integer typedef macros,
PROS/EZ user ARM instruction mode, ARM/Thumb interworking, the 32-byte boot header,
ELF section/address bounds, cold/hot layouts, `.hot_init` treatment, and the
existing cold-symbol stripping/weakening rules. Keep complete cold SDK sections
so future programs can reference functions absent from the first program.

The timestamp C source currently introduces a fresh wall-clock value per PROS/EZ
build. User `__DATE__`, `__TIME__`, and `__TIMESTAMP__` also require special handling.
No cache may silently change these semantics.

## Implementation work packages

Each package has an owner, a bounded change, and evidence required for completion.
Assign agents after the shared contracts are agreed. Avoid simultaneous edits to
`browser-build.ts`; use sequential integration or explicit file ownership.

### P0. Establish phase instrumentation and reproducible baselines

Owner: measurement agent. Start first; maintain the reporting contract.

Files: worker/client/compiler modules, browser benchmark tooling, existing e2e
fixtures, and a new browser performance report directory.

Implementation:

- Add optional structured timing events with build ID, phase, monotonic start/end,
  cache outcomes, and counts. Preserve existing result consumers or version the
  message protocol. Instrument failed and cancelled builds too.
- Measure manifest loading, asset download/cache read/integrity, decompression,
  WASM initialization, SDK mount, project synchronization, dependency validation,
  PCH validation, individual compile invocations, timestamp generation, cold link,
  hot/user link, symbol transformation, binary conversion, cache persistence, and
  main-thread artifact availability.
- Report source/object counts, objects reused, commands executed, bytes fetched,
  written, hashed, copied, cached, and returned where measurable.
- Record spans for overlapping work. Do not add overlapping phase durations and
  present the sum as end-to-end wall time.
- Separate click-to-artifact time from commit/repository operations and Brain
  upload time. Also record the complete user workflow on the project route.
- Record compiler/SDK version, fixture digest, device/OS/browser version, available
  hardware signals, cache state, PCH state, and test mode. Note unavailable memory
  metrics rather than inferring total usage from JavaScript heap alone.
- Export machine-readable raw samples and a summary with median, p95, range,
  failures, and peak-memory observations. Use at least ten repeated samples for
  edit scenarios; report sample count and avoid a strong p95 claim from small runs.
- Measure instrumentation overhead and keep expensive tracing disabled by default.

Acceptance: reproducible baseline for every template on both real routes, a real
low-end Chromebook baseline if hardware is available, and explicit limitations
where access is missing. Existing unrelated cloud measurements remain separate.

### P1. Retain mounted sessions and synchronize only changed files

Owner: session agent. Depends on P0 instrumentation and shared ownership contract.

Files: `build.worker.ts`, `build-client.ts`, source synchronization in
`browser-build.ts`, and callers providing workspace identity.

Implementation:

- Retain a session for the active workspace, compiler, SDK, and ABI generation.
  Use supported `Session` APIs, including `remove` and potentially `writeTree`.
- Mount ordered SDK overlays once. Preserve overlay order and project overrides.
- Store project path/content versions and write only changed files. Remove deleted
  source/header/configuration files and obsolete generated outputs. On deletion
  of a workspace override, restore its SDK baseline if one exists.
- Separate immutable SDK baseline files from mutable project files and scratch
  outputs. Linker-script normalization currently rewrites a file; retain original
  bytes and apply the transformation consistently without cumulative mutation.
- Ensure removed source objects cannot enter a later link. Clear stale depfiles
  and partial outputs after failures where needed.
- Pin a coherent manifest generation for the session. Apply discovered upgrades
  between builds by creating a new generation, never halfway through a build.
- Keep one active session by default. Reset on incompatible versions, uncertain
  filesystem state, hard cancellation, or a worker/runtime crash.
- Replace the unconditional 60-second expiry with a documented memory-conscious
  policy. Preserve warm state during ordinary editing pauses. Release on project
  disposal and expose an explicit reset path. Inspect real memory before choosing
  expiry thresholds; do not retain several heavy sessions indefinitely.
- Verify package internals before claiming that a fresh session recompiles WASM.
  The optimization here is proven filesystem/setup reuse; module behavior needs
  separate measurement.

Acceptance: unchanged builds perform zero SDK writes and zero project writes;
one-file edits write only that file plus required generated outputs. Cross-project
switches, deletions, cancellation, failures, and two-minute pauses remain correct.

### P2. Reuse dependency digests and narrow object invalidation

Owner: cache correctness agent. Depends on P0; coordinate with P1 and P3.

Files: `browser-build.ts`, `build-cache.ts`, SDK manifest preparation.

Implementation:

- Memoize each file digest and time-macro classification once per content version.
  Invalidate on writes, deletes, restoration of SDK files, and session replacement.
- Package digests for immutable SDK files and consume them only while effective
  bytes still match the mounted immutable baseline.
- Reuse shared dependency work across object and PCH checks. Avoid repeatedly
  reading copied buffers from `Session.readFile` or decoding large binary inputs.
- Replace the namespace containing every workspace path with compiler/SDK/config
  identity plus the include-resolution protection specified above.
- Keep ordered compiler arguments and actual dependency contents in object keys.
  Include effective custom compile commands and time-sensitive macro behavior.
- Version manifests and cache entries. Validate cache metadata shapes, bound sizes,
  and rebuild on corrupt/incomplete records. Do not turn arbitrary cache JSON into
  uncontrolled filesystem reads.

Acceptance: a README addition does not recompile existing sources; an added source
compiles itself and relinks. Header edits, newly shadowing headers, `__has_include`
changes, missing dependencies, flags, and ABI changes invalidate safely. Shared
headers are hashed at most once per unchanged content version during a build.

### P3. Strengthen and expand precompiled headers

Owner: header agent. Depends on P2's include-resolution rules.

Files: `prepare-ez-pch.ts`, PCH selection in `browser-build.ts`, manifests.

Implementation:

- Replace exact workspace-path matching with actual dependency/configuration
  matching and safe include-inventory invalidation.
- Preserve the requirement that the umbrella header is the first applicable
  directive. Source-defined macros and incompatible sources use ordinary parsing.
- Fingerprint compiler build, target ABI, language standard, relevant flags,
  include ordering, macro definitions, and umbrella-header dependency bytes.
- Treat a missing or incompatible optional PCH as a normal compile path. Recover
  from PCH rejection without hiding genuine compiler diagnostics or looping.
- Measure candidates for PROS, VEXcode, and JAR. Enable only where measured parsing
  savings justify download, startup, and retained-memory costs.
- Consider a project-specific PCH for edited umbrella headers. Generate once per
  valid configuration and amortize over multiple sources/builds. Avoid creating
  one for a small project where generation costs more than it saves.
- Account for automatic formatting during the first commit. It can legitimately
  change header bytes and invalidate a packaged PCH; do not claim an unchanged
  starter after formatting or use unsafe textual normalization to bypass it.
- Current EZ PCH adds roughly 13.7 MB of compressed download. Choose eager, idle,
  or lazy loading from cold-start measurements rather than enabling all PCHs eagerly.

Acceptance: adding an unrelated file keeps compatible PCH usage. Header, flags,
macro, include-resolution, compiler, and language changes reject incompatible PCHs.
Results remain equivalent to compilation without PCH.

### P4. Ship prebuilt cold SDK artifacts and cache derived outputs

Owner: SDK agent. Depends on P0; coordinates packaging schemas with P3 and P8.

Files: SDK preparation/packaging scripts, `BuildSdkManifest`, cold-link section of
`browser-build.ts`, `elf-binary.ts`, asset loading.

Implementation:

- Generate the full cold ELF, stripped/weak import-symbol ELF, and uploadable cold
  binary when packaging each compatible PROS/EZ SDK.
- Use the same pinned LLD and link semantics as the browser reference path, or
  prove equivalence before using another linker. Preserve section flags and all
  ABI corrections. Record toolchain, source-library, script, and transformation
  provenance plus digests and byte sizes.
- Add optional versioned manifest fields. Prefer prebuilt outputs only when actual
  effective libraries and scripts match their provenance. A changed workspace
  firmware file must trigger a correct dynamic cold link or existing explicit
  unsupported-configuration behavior, never reuse the default cold package.
- Normalize linker scripts identically during packaging and runtime. Include the
  normalization version in identity.
- Keep the dynamic browser path for older manifests, supported customized inputs,
  and optional artifact unavailability. Invalid assets must not be trusted.
- Cache symbol transformations and ELF-to-binary conversion for dynamic fallback
  results, keyed by original ELF digest and transformation version.
- Avoid hashing all immutable archives on every build. Reuse verified digests;
  rehash mutable overrides when their content changes.
- Measure transfer tradeoffs. Do not download the full ELF if only the import
  symbols and binary are needed. Load runtime libraries still required by hot
  linking; do not remove them solely because a cold package exists.

Acceptance: standard PROS/EZ builds issue no browser cold-link command, and repeated
fallback builds skip unchanged transformations. Prebuilt binaries and hot-link
behavior match the reference, including hot overrides and later use of additional
SDK functions. Firmware changes invalidate prebuilt eligibility.

### P5. Remove avoidable timestamp compiler work

Owner: metadata agent, or a follow-up by the SDK agent. Depends on P4 correctness.

Files: timestamp generation in `browser-build.ts`, packaging scripts if needed.

Implementation:

- First measure the tiny per-build timestamp Clang invocation separately.
- Define existing timestamp and compile-directory semantics before optimization.
- Investigate a prebuilt relocatable metadata object with explicitly patchable
  integer/string storage. Validate ELF layout, relocations, endianness, alignment,
  string capacity, and date formatting. Use the current compiler path if validation
  fails. Assembly is an alternative only if its own startup cost is worthwhile.
- Preserve fresh-build timestamps by default. Any reproducible timestamp policy
  must be an explicit product decision and part of cache identity.
- Keep user time-sensitive macros outside ordinary object/final-output reuse.

Acceptance: metadata symbols and observable values match the documented policy;
no fragile byte-offset patching without a validated schema. Retain the old path if
the measured benefit is small relative to complexity.

### P6. Add safe final-result reuse and separate stable artifact ownership

Owner: artifact agent. Depends on P2, P4, and P5 policy.

Files: `build-client.ts`, `browser-build.ts`, result persistence, project route,
download/upload consumers. Inspect existing serial APIs before altering transfers.

Implementation:

- Distinguish displaying a previously built commit from proving that the current
  snapshot has an equivalent build. Existing IndexedDB records alone do not prove
  compatibility with a new compiler/SDK or mode.
- Key reusable final results by all compile/link inputs, ordered source/object
  inventory, effective SDK, compiler, mode, and metadata policy.
- Reuse completed outputs for eligible unchanged snapshots. For fresh timestamp
  semantics, reuse stable compilation work and regenerate/relink metadata rather
  than returning an old timestamp as a fresh build.
- Store stable cold artifacts once by content digest and let hot results reference
  them internally. Keep the existing public result shape compatible until all
  consumers support references. Materialize complete downloads when needed.
- Avoid repeatedly transferring or persisting multi-megabyte unchanged cold bytes
  where the worker/main-thread protocol safely supports a reference handshake.
- Preserve Brain upload's existing matching-cold reuse. Verify that a missing or
  mismatched Brain library still uploads the complete correct cold package.
- Bound IndexedDB storage and handle migration, corruption, quota failure, and
  unavailable referenced blobs. Show correct commit/build provenance after reuse.

Acceptance: eligible no-op builds skip compile/link/package work; metadata-sensitive
builds follow their policy. Downloads and uploads work after reload, worker reset,
cache eviction, and transfer of a previous result's buffers.

### P7. Move cache persistence and eviction off artifact readiness

Owner: cache agent. Depends on P2; coordinate shared cache module ownership.

Files: `build-cache.ts` and cache lifecycle hooks.

Implementation:

- Make valid in-memory entries available immediately, then queue persistence.
  Persistent manifest records must not advertise blobs that are not durably stored.
- Batch Cache Storage writes and eviction rather than enumerating all keys after
  every put. Keep queues bounded; flush opportunistically without holding up the
  result. Losing pending writes when a worker exits is an acceptable cache miss.
- Use byte budgets and recency, not only the current 128-entry cap. Apply bounds
  on reads too; current persistent reads can populate memory independently of puts.
- Distinguish heavy SDK outputs from small object metadata where useful. Select
  actual budgets from device measurements and record eviction events.
- Reduce redundant copies only with clear ownership. Never let external consumers
  mutate cached bytes or detach their buffers.
- Handle multiple tabs, partial writes, quota errors, and private browsing as
  misses. Avoid holding large transient buffers while persistence is stalled.

Acceptance: storage failure does not fail a valid build; cache writes/eviction no
longer dominate artifact-ready time; memory and pending-write bytes stay bounded.

### P8. Improve asset loading, packaging, and controlled preload

Owner: asset agent. Depends on P0; agrees manifest schema with P3/P4 first.

Files: `build-assets.ts`, worker initialization, SDK/header packaging scripts,
compiler preparation, service-worker asset handling, deployment cache headers.

Implementation:

- Pin a coherent manifest set per session and revalidate outside the active build.
  Use immutable version/content URLs and appropriate deployment cache headers.
  Update compiler, header, library, PCH, and cold-artifact generations atomically.
- Retain verified bytes or modules within the worker lifetime so the same cached
  asset is not repeatedly hashed and decoded. Verify newly loaded persisted bytes
  before trust; a prior session's verification is not proof of current integrity.
- Replace gzip JSON/base64 binary bundles with a versioned binary archive carrying
  a bounded file index and raw payload bytes. Measure tar or a simple indexed
  container before writing a complex archive implementation.
- Validate paths, lengths, ranges, duplicates, counts, decompressed-size limits,
  and overlay precedence. Preserve provenance and license files.
- Support old bundles during migration or release all consumers together. Shared
  language/compiler manifests must not break clangd consumers. Inspect both.
- Inspect the compiler loader's existing module caching and supported `AssetLoader`
  response/bytes APIs. Evaluate streaming compilation only with correct WASM MIME,
  browser support, integrity strategy, and fallback. Do not claim repeated WASM
  recompilation until instrumented. Do not run unchecked bytes just to stream.
- Preload likely-needed assets after project opening or during idle periods with
  cancellation, low-memory limits, and network policy. Avoid downloading all SDKs
  or competing with initial editor/clangd readiness.
- Preserve cached offline builds and surface actionable download failures.

Acceptance: repeated warm builds need no manifest network wait or repeated bundle
decode. Cold loading reduces measured parsing/copying cost and peak memory. Old
and new manifest paths, corruption, deployment upgrades, and offline cases pass.

### P9. Keep the editor responsive during compilation

Owner: integration/UI agent. Depends on P0 and P1 lifecycle notifications.

Files: project route, `workspace-editor.tsx`, `clangd-client.ts`, worker log protocol.

Implementation:

- Batch worker output and React updates at a measured interval, initially evaluate
  50–100 ms. Bound buffers, preserve chunk order and UTF-8 decoding, and flush on
  success, failure, and cancellation. Avoid repeatedly copying a 400 KiB string.
- Keep final diagnostics available immediately after a failed build. Preserve
  source location links, output scrolling, and accessibility.
- Coordinate clangd did-change bursts and diagnostics scheduling while a build is
  active. Defer expensive work where supported, then process the newest version
  after completion. Do not drop document versions or leave diagnostics stale.
- Avoid terminating clangd on each build; restarting may cost more than deferral.
  Compare both CPU and memory contention with language services active.
- Profile Pierre rendering/highlighting and file-tree updates on the actual route.
  Optimize only costs demonstrated there and use supported extension points.
- Keep build-stage implementation details in developer reporting. Product UI should
  expose useful progress, cancel/retry, and clear errors.

Acceptance: typing and navigation remain responsive on the Chromebook during a
large build; logs and diagnostics are complete; clangd catches up after every exit
path. Record long tasks and an interaction-latency measure alongside build latency.

### P10. Evaluate a fast development optimization mode

Owner: compiler configuration agent. Depends on P0 and P2 mode-aware identity.

Files: compile-command construction, settings UI if approved by evidence, tests.

Implementation:

- Compare current `-Os` with `-O0` and `-O1` for all templates and representative
  programs. Measure compile/link time, binary size, load-address limits, upload
  time, and program runtime behavior.
- Preserve target ABI and supported explicit project settings. Resolve duplicate
  optimization flags deliberately and make the effective mode inspectable.
- If useful, expose a simple development/optimized choice using existing UI
  conventions. Include mode in object, PCH, starter, and final-result keys.
- Do not silently change deployed robot behavior or select an oversized output.
  A development binary that exceeds device bounds must fail clearly.

Acceptance: measured tradeoffs justify the option; switching modes cannot reuse
incompatible artifacts. Document runtime and size effects. Keep current defaults
until evidence supports a change.

### P11. Evaluate bounded parallel compilation

Owner: experimental compiler agent. Depends on P1/P2 and memory measurements.

Implementation:

- Compare one and two compiler sessions on larger multi-source projects. Do not
  equate `hardwareConcurrency` with enough memory for that many compilers.
- Keep one as the default for low-memory/unknown devices. Only raise concurrency
  with evidence; `deviceMemory` is a coarse hint, not a guaranteed memory budget.
- Use independent sessions/filesystems if the compiler API is not reentrant.
  Account for duplicated mounted SDKs, WASM memories, PCHs, and object transfers.
- Schedule cache misses only, assemble link objects in stable order, attribute
  diagnostics to source/build IDs, and cancel all active work reliably.
- Avoid oversubscription with clangd. Fall back after allocation failures, crashes,
  or device policies that prohibit a pool.

Acceptance: improve end-to-end latency without memory-pressure failures, tab
discards, or worse editor responsiveness. Leave disabled if it loses on target
hardware. Document pool teardown and cache/session ownership.

### P12. Ship verified starter objects where worthwhile

Owner: template agent. Depends on P2/P3 and packaging infrastructure.

Implementation:

- Precompile unchanged template source files with the pinned browser-compatible
  compiler, SDK, command arguments, and full dependency metadata.
- Reuse through the same cache validation rules as locally compiled objects,
  including include inventory and time-sensitive macros. Never key on template
  name alone or skip validation because a project looks like a starter.
- Generate reproducibly and record provenance. Fetch only required objects.
- Evaluate first-commit formatting and likely student edits. A packaged object
  that almost never remains eligible may not justify its download.

Acceptance: standard starter builds compile fewer sources with identical behavior;
any source/header/flags/ABI changes reject affected packaged objects.

### P13. Investigate a smaller compiler and less driver overhead

Owner: toolchain research agent. Depends on phase data; larger follow-up effort.

Implementation:

- Inspect the pinned package and patches before creating a fork. Document what
  `llvm.core*.wasm` modules contain and which modules actually load for this target.
- Prototype a supported ARM-focused Clang/LLD build excluding demonstrably unused
  backends/tools. Keep assembly, required builtins, C++ features, diagnostics,
  resource headers, linker capabilities, licenses, and reproducible build scripts.
- Compare transferred size, decompressed size, WASM initialization, peak memory,
  and compile/link performance. Build-time slimming may not speed compilation.
- The wrapper may dry-run the driver with `-###` and replay subcommands. Measure
  its cost. Prefer supported APIs; evaluate safe resolved-command caching only
  after checking command inputs, resource paths, flags, depfiles, and diagnostics.
- Direct `cc1` execution is experimental. Never bypass ABI flags or custom command
  behavior just to skip driver work. Do not edit installed dependency files as the
  durable solution; use reproducible patches or an upstream change.

Acceptance: full regression matrix and compatibility report; retain the pinned
toolchain fallback until the slimmer one is proven. Publish maintenance costs.

### P14. Removed

The explicit remote build fallback was removed at the user's request. P0–P13
remain in scope. The earlier backend build pipeline remains available to existing
tooling, without a cloud option in the project route.

## Assignment and integration order

Suggested rounds for agents. This is a handoff structure, not a requirement to
launch agents merely to read the plan.

| Round | Work                                   | Integration requirement                                             |
| ----- | -------------------------------------- | ------------------------------------------------------------------- |
| 0     | P0, shared identity/protocol contracts | Land instrumentation and baseline                                   |
| 1     | P1 and P2                              | Serialize shared compiler-module changes                            |
| 2     | P3, P4, P7, P9                         | Agree manifest/cache schemas first; integrate one owner at a time   |
| 3     | P5, P6, P8                             | Coordinate timestamps, artifact references, and packaging migration |
| 4     | P10 and P12                            | Use established mode and dependency keys                            |
| 5     | P11 and P13                            | Experiments gated by memory and measured benefit                    |

The fastest practical first delivery is P0–P4 with P7 and P9. Then address final
artifact reuse and cold asset costs. Keep P10–P13 as fully scoped follow-ups, with
go/no-go results accepted when an experiment does not help the target device.

One integration owner controls `browser-build.ts` changes and validates combined
behavior. Packaging agents agree a single manifest evolution. Protocol changes
update worker, client, route, and artifact consumers together. Keep feature flags
or internal switches for reference/fallback paths until comparison is complete.

## Verification matrix

Implementation agents should add focused correctness coverage and run relevant
existing tests for their packages. Use the real routes for browser integration;
low-level compiler/cache tests supplement that verification.

For every template, test these states and edits:

- Fresh site storage, warm assets with empty intermediates, warm worker, reload,
  cached offline rebuild, two-minute pause, and project switch.
- No source change, one source edit, common header edit, new source, deleted source,
  deleted header, README addition, header rename, and revert to an earlier version.
- Header shadowing, `__has_include` changes, nested relative includes, forced
  includes, and supported custom `compile_commands.json`.
- Compiler flags, standard, optimization mode, SDK/compiler generation, firmware
  library/script overrides, and macros that change preprocessing.
- User date/time macros and generated metadata under the chosen timestamp policy.
- Deliberate compile/link error followed by correction; cancelled build followed
  by retry; worker crash; obsolete result arrival; two tabs and concurrent requests.
- Corrupt manifests/PCH/objects/final blobs, missing referenced cold data, storage
  denial/quota exhaustion, interrupted downloads, and partially updated deployment.
- PCH enabled versus disabled, cache enabled versus disabled, packaged cold output
  versus dynamic reference, and retained session versus fresh reference.
- Download, IndexedDB restoration, and upload of all required artifacts. On a real
  Brain, test cold-library match/mismatch and representative program behavior if
  hardware is available. Report lack of device access explicitly.

Compare deterministic binary regions and ELF semantics against the reference.
Control or account for timestamps before requiring byte equality. Check artifact
paths, boot header, address bounds, cold/hot symbols, `.hot_init`, and native
`arm-none-eabi-objcopy` equivalence where the existing tooling supports it.

## Chromebook benchmark protocol and completion gates

- Use a real low-end Chromebook, preferably 4 GB RAM, plus a development machine.
  Record model, CPU, RAM, OS/browser, power state, and other active workloads.
- Include standard templates and larger synthetic multi-source/header-heavy
  projects. Test the actual project route with Pierre and clangd active.
- Measure cold installation separately from warm full build, one-source edit,
  common-header edit, no-op rebuild, and resume after a pause.
- Alternate baseline and optimized runs to reduce temperature/order bias. Restore
  documented cache states; do not silently compare different PCH eligibility.
- If using calibrated browser CPU throttling, label its factor and mechanism.
  Keep contention-worker tests in a separate dataset. Neither replaces hardware.
- Record memory-pressure symptoms, tab crashes/discards, failed allocations,
  language-service startup, UI long tasks, and artifact/upload size alongside time.
- Compare medians and tail latency by scenario. Agree numerical latency and memory
  budgets after the baseline is available; do not invent guaranteed speedups now.
- For default-on changes, require correct outputs, measured target-device benefit,
  no unexplained regression in other templates, and bounded memory/storage. Explain
  any tradeoff and keep a fallback where compatibility is uncertain.

Structural completion gates for the first delivery:

1. Warm sessions do not remount unchanged SDKs or rewrite unchanged project files.
2. Standard PROS/EZ builds avoid runtime cold linking and repeated cold conversion.
3. Dependency checks avoid repeated hashing of unchanged shared headers.
4. Unrelated file additions preserve compatible object and PCH reuse.
5. Cache persistence does not delay artifact readiness unnecessarily.
6. Editor/log/language-service behavior remains correct during and after builds.
7. Cancel, failure, version change, and eviction cannot return stale artifacts.
8. Every performance claim names its device, scenario, cache state, and sample count.

## Reporting and final handoff

Each agent returns:

- Package IDs implemented, files changed, and dependency/schema changes.
- Before/after raw measurements and the exact reproduction steps.
- Correctness tests run, route verification, hardware checks, and access limitations.
- Memory/download/storage tradeoffs and remaining failure cases.
- Default behavior, migration/fallback strategy, and how to disable the experiment.
- Remaining work or a measured reason to reject an experimental optimization.

The integration owner updates `browser-builds.md` with actual lifecycle and cache
rules after implementation. Store browser performance results separately from
cloud reports. Produce T3 visualizations from the raw data: phase timelines for
overlapping startup, before/after scenario comparisons per template, object/PCH
reuse, and latency versus peak memory for concurrency experiments. Clearly label
missing measurements. Check self-contained visualization HTML with `html_preview`
and publish it with `html_render`.

The final handoff must say which improvements are shipped, which experiments were
rejected or deferred, and what remains unverified on a real Chromebook. Do not
declare the entire plan complete merely because the first batch is faster.
