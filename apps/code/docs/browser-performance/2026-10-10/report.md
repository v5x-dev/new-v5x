# Comparison against main

The baseline is `origin/main` at `efdb141c67128326882091bcd2632fd5a05d3119`. Both sides were rerun sequentially on October 10, 2026, on an Intel Core i7-8700K with 32 GB RAM, Linux x64 and Bun 1.4.2. Seven samples per template and scenario. The baseline loads its own compiler adapter, package patch and SDK manifest from that exact revision. The optimized side uses this PR's implementation and prepared assets. Both use the same template sources and edit fixtures.

Each sample starts with a new filesystem and empty object cache. Starter-object reuse is disabled. The source edit changes one delay instruction; the header-only edit changes a consumed macro without changing the source. Every edited build must change both firmware and the compiled main object. Unchanged controls are excluded. Fresh workspace measurements can use validated cold SDK assets. They are not cold compiler startup measurements.

These are compiler-only WASM compile/link/package timings, excluding initialization, SDK mounting, network and editor/UI. Browser performance was measured separately on the real `/build-demo` application route with five samples per template. Its final EZ worker medians were 713 ms for source edits and 919 ms for header edits, so sub-500-ms browser builds are not established. Sequential sampling and JIT variation limit small-difference claims.

| Template | Workload | main ms | PR ms | Speedup |
| --- | --- | ---: | ---: | ---: |
| VEXcode | Fresh workspace | 192 | 63 | 3.03× |
| VEXcode | One-line source edit | 199 | 59 | 3.39× |
| VEXcode | Header-only edit | 195 | 60 | 3.24× |
| PROS | Fresh workspace | 931 | 99 | 9.44× |
| PROS | One-line source edit | 909 | 89 | 10.16× |
| PROS | Header-only edit | 914 | 89 | 10.26× |
| EZ | Fresh workspace | 1557 | 777 | 2.01× |
| EZ | One-line source edit | 895 | 501 | 1.79× |
| EZ | Header-only edit | 5603 | 764 | 7.34× |
| JAR | Fresh workspace | 2768 | 487 | 5.68× |
| JAR | One-line source edit | 425 | 80 | 5.33× |
| JAR | Header-only edit | 2777 | 476 | 5.83× |

Final individual timings and object hashes are retained in [samples.jsonl](samples.jsonl), one JSON record per line. `main` and `optimized` records measure compiler-only time in `ms`; `browser` records include worker totals in `workerMs` and interaction time in `wallMs`. Intermediate experiments and phase traces stay in the ignored `.build/compiler-edits` directory.

The compiler uses geometric filesystem writes, checked SDK-prefix PCH, driver-generated frontend commands, bounded hash/dependency reuse and concurrent startup assets. PROS, EZ and JAR instantiate SDK templates during PCH preparation. Browser builds select the Binaryen core for EZ and the original core for other templates. Firmware optimization levels are unchanged. See [compiler provenance and regeneration](../../../compiler/README.md).

Compressed PCH sizes are 5.54 MB for PROS, 14.10 MB for EZ, 2.66 MB for JAR and 1.07 MB for VEX. The alternate compiler adds an 18.19 MB compressed build input. These are one-time download costs.

The original pass checked generated code, data, symbols and relocations against full-driver, no-PCH compilation across six fixtures per template. Real WASM and real-route browser checks covered edits, errors/recovery, SDK overrides and compiler switching. Physical Brain execution and low-end Chromebook acceptance were not performed in this pass.

Reproduce from the repository root, with other builds and packaging stopped:

```sh
BUILD_BASELINE_REV=efdb141c67128326882091bcd2632fd5a05d3119 BUILD_BENCH_SAMPLES=7 bun apps/code/scripts/benchmark-compiler-edits.ts pr-main
BUILD_BENCH_SAMPLES=7 bun apps/code/scripts/benchmark-compiler-edits.ts pr-optimized
BUILD_VERIFY_COMPILER_PLANS=1 BUILD_VERIFY_EDITS=1 BUILD_VERIFY_SDK=1 bun apps/code/scripts/verify-browser-builds.ts
```

From `apps/code`, against the running application:

```sh
BUILD_COMPILER_EDITS=1 BUILD_BENCH_SAMPLES=5 PLAYWRIGHT_BASE_URL=http://localhost:3001 bunx playwright test e2e/compiler-edits.spec.ts --workers=1 --reporter=list
```

Benchmark scripts write full records and phase traces under `.build/compiler-edits`, outside the PR.
