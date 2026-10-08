# V5 Brain hardware results

October 8, 2026. All 24 cases passed on a V5 Brain running VEXos 1.1.5, connected
directly to the Linux development computer over USB. No unplug/replug was needed.
The user port used DTR/RTS. These are development-machine observations, not
Chromebook measurements.

## Coverage

The pinned WASM Clang/LLD compiler produced 20 fixtures: reference, optimized, O0,
O1 and project PCH for VEXcode, PROS, EZ and JAR. Each fixture replaces project
sources with a safe two-source task that allocates a C++ vector, accumulates 30,
and repeatedly prints the template, variant, value and date/time macros. PROS/EZ
also print the build metadata epoch/date. The fixture has no motor commands.
Original template headers/configuration remain, but this does not exercise the
full original robot programs or starter-object reuse. All fixtures use one worker.

All 20 booted and executed the task. PROS/EZ metadata matches fixture compilation
time within 60 seconds. Their optimized variants each ran with a missing, matching
and mismatched private cold library, adding four cases. Matching libraries were
reused; missing and mismatched libraries were transferred and ran correctly.

Uploads used the production `V5SerialConnection.uploadProgramToDevice` method
through the Bun USB adapter. Runtime markers came from the dedicated USB user
port, with framebuffer/OCR as a fallback. This is not a browser WebSerial test.
Synthetic `hardware-...` commit IDs identify fixtures, not repository commits.

Readback compares every aligned compressed byte and the complete file size/CRC32
reported by the Brain. Missing/mismatched cold packages receive the same check.
VEXos 1.1.5 rejects unaligned reads and reads past EOF, so the final one to three
bytes of unaligned files are covered by the full-file CRC, not direct readback.

## Observed uploads

One observation per case. Upload time excludes runtime checking and readback.
`runtimeMs` in the raw results includes the deliberate wait, framebuffer/OCR and
readback; it is not task startup latency. Sizes below exclude INI and USB framing.
Cached cold bytes reported by the callback are not bytes transferred.

| Template     | Variant     | Cold scenario | Upload ms | Hot wire bytes | Cold wire bytes |
| ------------ | ----------- | ------------- | --------: | -------------: | --------------: |
| vexcode      | reference   | upload        |       587 |          1,201 |               0 |
| vexcode      | optimized   | upload        |       328 |          1,202 |               0 |
| vexcode      | O0          | upload        |       330 |          1,999 |               0 |
| vexcode      | O1          | upload        |       331 |          1,211 |               0 |
| vexcode      | project-pch | upload        |       328 |          1,205 |               0 |
| pros         | reference   | upload        |      6296 |          4,083 |         666,307 |
| pros         | optimized   | missing       |      4556 |          4,088 |         666,307 |
| pros         | optimized   | matching      |       895 |          4,088 |               0 |
| pros         | optimized   | mismatched    |      4394 |          4,088 |         666,307 |
| pros         | O0          | upload        |      1215 |          5,846 |               0 |
| pros         | O1          | upload        |       765 |          3,824 |               0 |
| pros         | project-pch | upload        |       761 |          4,087 |               0 |
| ez-template  | reference   | upload        |      9146 |          4,083 |       1,058,651 |
| ez-template  | optimized   | missing       |      7435 |          4,085 |       1,058,651 |
| ez-template  | optimized   | matching      |      2006 |          4,085 |               0 |
| ez-template  | optimized   | mismatched    |      8823 |          4,085 |       1,058,651 |
| ez-template  | O0          | upload        |      1228 |          5,322 |               0 |
| ez-template  | O1          | upload        |      1231 |          3,767 |               0 |
| ez-template  | project-pch | upload        |      1226 |          4,087 |               0 |
| jar-template | reference   | upload        |       350 |          1,213 |               0 |
| jar-template | optimized   | upload        |       350 |          1,214 |               0 |
| jar-template | O0          | upload        |       340 |          2,011 |               0 |
| jar-template | O1          | upload        |       341 |          1,216 |               0 |
| jar-template | project-pch | upload        |       338 |          1,212 |               0 |

These samples establish correctness and record transfer costs. They do not
establish medians, p95, optimization speedups or motor/competition performance.

## Serial fixes found on hardware

- Accept USB file-read replies that omit the ACK byte while preserving
  ACK-prefixed transport compatibility and rejecting short error replies.
- Avoid read chunks whose ACK-less USB reply is an exact 64-byte packet multiple.
  A 500-byte payload produced a 512-byte reply that remained buffered until a
  subsequent command. Splitting it into 496 and 4 bytes completed immediately.
- Add optional Bun adapter DTR/RTS signals for the dedicated user CDC port.
  System-port FIFO reads returned NACK 255 on this Brain. `printf` worked on the
  user port; `vex_printf` did not provide a terminal marker. Browser terminal
  behavior remains outside this run.

Serial validation passes 26 tests and typecheck/build. App validation passes 72
IDE tests, runner lint, typecheck and production build.

## Cleanup and reproduction

Slot 8 and `v5x_hw_test_cold` were initially unused. Original slots 1 and 2 and
both preexisting cold libraries were retained. The final inventory matches the
initial filenames, sizes, CRCs and load addresses. The test program is stopped.
Removing `slot_8.ini` also removes its binary on this firmware; the subsequent
binary deletion returns false. Final inventory verification passed.

From the repository root, with a powered Brain and a free slot 8:

```sh
bun apps/code/scripts/verify-brain-builds.ts --prepare
bun apps/code/scripts/verify-brain-builds.ts --upload
```

The runner needs Python 3, ImageMagick `convert` and Tesseract. Ports default to
`/dev/ttyACM0` and `/dev/ttyACM1`; override `BRAIN_PORT` and `BRAIN_USER_PORT`.
Use `BRAIN_TEMPLATES` and `BRAIN_VARIANTS` for comma-separated filters.
It refuses occupied slot 8 or an existing private library name and cleans up
only files it creates. Fixtures/binaries remain in gitignored `.build`.

Raw evidence is in [results.json](results.json) and [fixtures.json](fixtures.json).
Fixture metadata records artifact SHA-256, compilation times and build spans.

## Remaining acceptance

The [hardware checklist](../hardware-checks.md) retains Chromebook timing/memory,
real-route restored/downloaded artifacts through browser WebSerial, full robot
programs, original starter objects and two-worker outputs. P14 and its cloud
acceptance checks were removed at the user's request after this hardware run.
Project PCH, O0/O1 and two workers remain internal experiments.
