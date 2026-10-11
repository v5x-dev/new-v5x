# Optimized browser compiler

The gzip file is a build input, derived from the pinned `microbit-clang-wasm@21.11.0-alpha.1` main module with Binaryen 133. Ordinary builds validate its compressed and decoded hashes and the package source hash, then publish a content-addressed module. Bun tooling uses that optimized module. Browser builds use it for EZ; VEX, PROS and JAR use the original module because Chromium measurements favored it for those projects. The original package module stays available for old workers and reference checks. The package's LLVM licenses are copied to the public compiler directory by preparation.

Reproduction requires Python 3 for the portable gzip wrapper. To reproduce on x86_64 Linux, download `https://github.com/WebAssembly/binaryen/releases/download/version_133/binaryen-version_133-x86_64-linux.tar.gz`, verify SHA256 `2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489`, and extract it. Run:

```sh
WASM_OPT=/absolute/path/binaryen-version_133/bin/wasm-opt bun apps/code/scripts/optimize-browser-compiler.ts
bun scripts/prepare-browser-compiler.ts
```

The script verifies the optimizer version, source identity and resulting hashes. The adjacent JSON records flags and provenance. Optimization takes several minutes and about 1.3 GB of host memory. It is intentionally separate from routine builds.

Regenerate SDK PCH, metadata, cold SDK and starter objects after changing compiler identity. Run `BUILD_VERIFY_COMPILER_PLANS=1 BUILD_VERIFY_EDITS=1 BUILD_VERIFY_SDK=1 bun apps/code/scripts/verify-browser-builds.ts` to compare optimized output with the original WASM compiler and exercise fallback paths.

The package patch accepts an optional immutable module identity in `setAssetLoader`. The runner passes the compiler manifest identity and selected core SHA256. Two compiled module sets are retained, with failed loads removed for retry. The SDK resource filesystem is shared because both cores derive from the same pinned package. Builds serialize within each worker.
