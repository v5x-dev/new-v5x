# Reduced browser LLVM build

`build-reduced.sh` reproduces the inputs for `microbit-clang-wasm@21.11.0-alpha.1` and builds an
experimental smaller WASI executable. It pins the package source at
`carlosperate/microbit-clang-wasm` commit `8bae55227c1573c7cbd9cb530bbe447d1521131a`, Arm's LLVM at
`arm/arm-toolchain` commit `0bac08d50952133963671eeeb8c3e67695a32f49`, and takes the WASI compatibility
patch and sysroot assembly steps from that package release.

The patch keeps Clang and LLD, disables the standalone LLVM command utilities, changes code generation
to `-Oz`, and keeps ThinLTO at two backend jobs. Both scripts place their work in a systemd scope capped at 8 GB
RAM with swap disabled. The LLVM target remains ARM, matching the V5 build's `arm-none-eabi`
driver and its C++ ABI flags. This is an experiment; the app and its compiler asset manifest still
use the published package.

Run it with `JOBS=6` (the default). Values from 1 to 6 are supported; keep the 8 GB memory cap and
swap disabled, and only raise the job count after checking the active scope's measured peak. The
default build directory is under `$XDG_CACHE_HOME/v5x/`, or
`$HOME/.cache/v5x/` when that variable is unset. `V5X_TOOLCHAIN_WORKDIR` can point elsewhere. The
output executable is `microbit-clang-wasm/llvm-build/bin/llvm` inside that directory. After it
finishes, run `scripts/toolchain-build/package-reduced.sh` to use Bun and the pinned upstream packaging
tools to generate WASM modules and run a C++/LLD smoke check with the V5 ARM ABI flags. The package
uses the upstream Arm sysroot and carries its license notices. No generated toolchain output belongs
in Git.

The upstream recipe is available at
https://github.com/carlosperate/microbit-clang-wasm/tree/v0-alpha.1. Its package is licensed under
the terms copied into `LICENSE.txt` and `LICENSES`; this build keeps the upstream license files next
to its inputs.
