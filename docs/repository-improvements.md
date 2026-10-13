# Repository improvement progress

This tracks the October 11 repository review at `a64afca`. The requested work
covers every review item. Partial implementations below do not mean the full
review is complete. Changes remain uncommitted.

| Review item              | Implemented                                                                                                                                                                                                                                             | Remaining acceptance and work                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Repository authorization | Internal repository registration; owner checks before storage access; pinned reads; negative authorization tests; quotas for project creation, duplication, and feedback                                                                                | Dedicated test backend; issuer-aware ownership migration                                             |
| Code durability          | Serialized draft writes; navigation flush; visible save/error recovery; guest-to-Google transfer; two-tab conflict protection and recovery download                                                                                                     | Real OAuth acceptance, including existing accounts; lifecycle review across writer instances         |
| Brain durability         | Versioned wiring JSON; autosave; import/export; node settings in graph data; failed-restore protection; required-connection validation                                                                                                                  | Broader reload/recovery acceptance and richer device validation                                      |
| Brain device simulation  | Distance state and scenarios; battery and controller controls; motor command transport; Rust protocol and host support; unsupported devices labelled and disabled; compiled C++ device demonstrations                                                   | Physical motor movement and hardware behavior are not simulated; physical V5 acceptance              |
| Design assemblies        | Versioned inch-based document; command reducer and undo/redo; numeric transforms; search/tree; duplicate/delete; autosave; JSON import/export; CSV parts list; limited hole alignment; development-only performance overlay                             | Full chassis mating, verified structural metadata, JSON/CSV route acceptance, and recovery UX review |
| Code project lifecycle   | Owner-only rename, duplicate, archive/restore, and delete with repository/build/handoff cleanup; paginated dashboard; validated source ZIP import/export; committed history with Pierre diffs and guarded restore; account-backed stars and search/sort | Actual-route restore acceptance; production deletion acceptance                                      |
| Code to Brain            | Versioned, hashed VEXcode artifact manifest; source identity and staleness checks; one-time origin-checked handoff to Brain; browser validates the manifest and artifact hash                                                                           | Dedicated-backend and actual-route handoff acceptance; PROS/EZ/JAR hot/cold loading                  |
| Quality gate             | Root check/build commands; CI lint/unit/typechecks/builds; Rust host and kernel jobs; Serial export smoke test; Brain asset provenance check and independent rebuild script                                                                             | Automated Brain/Design route suites; dedicated backend; Chromebook and physical-device matrix        |
| Maintainability and docs | Cloud pool replenishment is explicitly opt-in; Design and Code workspace docs updated; build parallelism corrected; marketing support claims corrected                                                                                                  | Workspace/build/upload module extraction; Bluetooth UI after hardware acceptance                     |

## Verification recorded October 12, 2026

- Unit verification passes with 146 Bun tests and 19 Convex tests in Vitest’s
  Edge Runtime. The backend suite includes concurrent per-account quota limits
  and a global allocation limit for replacement guest accounts. Root lint, Serial,
  Code, Brain, and Design typechecks pass. Brain reports zero errors/warnings.
- Code backend tests cover guest transfers, cross-user denial, rename validation,
  archive/restore, pagination, and committed repository forks. Guest transfers
  preserve project IDs and commits, keep existing account projects, and repeat
  safely. Design tests also verify that mutable command inputs cannot corrupt history.
- `bun run --cwd packages/serial check:exports` passed against built package paths,
  ESM/CJS exports, browser adapter, and Bluetooth adapter. This does not open hardware.
- `bun run build:all` now passes for Serial, Code, Brain, Design, and Marketing.
  The earlier localhost restriction was removed by the updated environment.
- Rust protocol/host tests and host Wasm/kernel builds passed in the earlier work.
  Updated host bindings and `kernel.elf` are in Brain's public assets.
- `bun apps/brain/scripts/check-wasm.mjs` passed. It checks required assets and
  verifies source/asset hashes. Use the rebuild script after Rust changes.

Design’s real application route was opened through T3 preview on port 3101.
Catalog drop, autosave, duplicate/undo, numeric-transform undo, and reload
persistence passed. The hidden import input now has no layout or focus area.
A complete chassis, mating accuracy, JSON round trip, and CSV output still need
browser acceptance. Code OAuth remains unverified. Brain controller, distance,
battery, and motor-command values were read by a compiled C++ guest on the actual
route. No isolated editor harness was used. Physical V5 hardware and Chromebook
acceptance have not been performed.

Marketing now runs `astro check`, including `.astro` source. TypeScript 6 is
installed in that workspace because Astro’s checker does not support the root’s
TypeScript 7. Production builds pass and emit non-blocking chunk-size warnings;
Astro also notes its optional icons directory is absent.

Dependency installation exposed malformed registry lookups in Bun 1.4.2.
Bun 1.3.10 resolved the added checker dependencies using the existing locked
versions. The resulting lockfile is accepted by Bun 1.4.2 with
`bun install --frozen-lockfile`. No package manager other than Bun was used.

## Code lifecycle verification

Source ZIP tests cover Unicode and CRLF preservation, optional enclosing-folder
removal, path traversal, duplicates, ambiguous file/directory trees, symlinks,
binary content, compressed/expanded limits, truncation, and checksums. Generated
outputs and SDK binaries are omitted from source imports. A dedicated symlink fixture verifies rejection during directory validation.

Backend tests verify import authorization and validation before allocation,
registration of the newly created repository, cross-user history denial,
expected-head restore checks, native Git compare-and-swap arguments, and no
metadata update after a rejected restore. The configured development deployment
was updated with these fixes and the quota component. Production was not deployed.

A fresh guest in an incognito T3 preview successfully imported a three-file ZIP
through Code’s actual dashboard on port 3001. The imported project appeared in
the paginated list. History listing and all three Pierre diffs rendered in the actual dashboard.
The source export downloaded successfully. Restore browser acceptance remains pending.

The history dialog uses explicit dark Pierre rendering, independently scrolling
commit and diff panes, clear commit metadata, and a fixed restore footer. Opening
history selects the latest commit. Short viewports hide secondary metadata so
the diff remains visible. Code typecheck and lint passed. Actual-route checks at
desktop and 600-by-240 sizes confirmed legible dark diffs without horizontal
overflow.
The existing user-owned Vite server on port 3000 was left running.

Account stars are stored on owned project records and preserved during guest
transfer. Backend tests cover persistence, unstar, unauthenticated denial,
cross-user denial, and transfer. Code lint/typecheck and all 19 backend tests
passed. The configured development backend was updated.

Dashboard name order and starred filtering now precede backend pagination.
Substring search scans bounded pages while preserving native cursors and split
metadata. The dashboard advances through empty matching pages automatically.
Tests verify name order across one-item pages, a substring match beyond the first
page, case-insensitive matching, stars, and exclusion of another owner. All 13
backend tests and Code lint/typecheck passed. The development backend was updated.
Actual dashboard search found the fixture with an uppercase substring.

Workspace reads and writes now share a per-project queue across editor instances
in the same page. A delayed save finishes before a reopened editor reads the
draft. Tests cover delayed-save/reopen ordering and recovery after a failed write.
Separate tabs coordinate through IndexedDB revisions: a stale writer cannot
replace a newer source and retains a recovery download. Dashboard validation now
accepts expanded reactive pages above 100 items, with a backend regression test.

Draft recovery JSON can now be imported through the real dashboard as a new
owned project. Version, path, text, file-count, and byte limits are validated
before preview and allocation. Tests preserve Unicode/CRLF and reject malformed
versions, traversal, nontext/binary contents, and file/directory ambiguity.
Code lint/typecheck passed. Actual-route acceptance selected a two-file recovery
JSON, previewed its sources, and created the recovered project.

Draft persistence now compares storage revisions inside the same IndexedDB
read/write transaction. A stale tab cannot overwrite a newer saved draft; its
writer reports the conflict and retains recovery download. Existing records
without revisions are upgraded on the first successful save. Browser-native
IndexedDB verification with independent persistence clients on the real dashboard
confirmed rejection, preservation, and saving after reread. Code lint/typecheck
passed.

Actual editor acceptance opened the recovered project in two tabs sharing the
same guest session. The newer tab saved its edit. Edits in the stale tab showed
a storage conflict and did not replace the newer persisted source. The stale
editor retained its text, and its downloaded recovery JSON contained both edit
markers. This used Pierre in the actual project route, without an editor harness.

Brain battery controls now persist and send capacity, voltage in mV, current in
mA, and temperature in degrees Celsius through worker RPC and the Rust host.
Default new wiring starts with a full 12 V battery at 25 degrees Celsius.
Host validation and graph bounds reject nonfinite state. Graph tests cover all
fields and voltage changes; the Rust packet test checks all four decoded fields.
Four device tests, five Rust host tests, Brain check/lint, Rust asset rebuild, and
asset provenance checks passed. The actual-route C++ fixture confirmed configured
battery values and a live voltage change.

Brain includes a repeatable four-second distance scenario for connected sensors.
It applies fixed far/near/no-target states through graph data and DeviceSync.
Scenario tests assert exact boundaries, repeatability, unchanged unwired sensors,
and invalid-input rejection. Controls stop playback and importing wiring cancels
it. Distance controls now follow externally updated node data. The actual-route
C++ fixture confirmed far/near/no-target scenarios and battery state.

The tracked freestanding C++ device fixture was compiled with ARM GCC and
uploaded through Brain on port 3102. Its terminal output confirmed all distance
scenario steps including 9999 for no target, all four configured battery fields,
and a live voltage change from 12500 to 11000 mV. This exposed dropped initial
UART state during boot. The host now emits brain_ready from the kernel code
signature, and worker startup waits for it before graph synchronization.
Rust host tests, Brain check/lint, rebuild and provenance checks passed.
Reset acceptance exposed browser file handles becoming unreadable after the
source file changes. Sessions now capture uploaded bytes on first start.
Reset succeeded after changing the uploaded file modification time. The
restarted guest reported the persisted distance and all battery fields.

Controller kernel groundwork now retains master/partner protocol updates, maps
SDK axes with signed values, maps buttons and battery capacity, and reports
connection status. Disconnected controller reads return zero. A protocol test
verifies axis order/sign, buttons, battery, invalid indices and disconnect.
Six protocol/host tests, kernel/host rebuild and provenance checks passed.

Controller browser RPC and Rust encoding accept validated controller IDs, four
signed axes, twelve button bits, capacity and connection state. The graph now
supports one Master and one Partner controller, disables occupied roles, caps
the sidebar at two nodes, validates imported controller settings, and disconnects
removed controllers. The C++ guest on Brain's actual route read axis values -127
and 42, L1/A pressed, and battery at 75 percent. Adding the Partner disabled a
third controller. Brain typecheck/lint and nine configuration/device tests pass.

The motor fixture was rebuilt and run through Brain's actual route with a motor
connected to port 2. The terminal showed `Motor port 2: velocity target 120` and
`V5X_DEVICE motor_target=120`. The fixture sends the command once to avoid
flooding the terminal. This confirms delivery only; the simulator does not
model motor movement or robot physics.
