# VEX LLVM build

Run `scripts/build-vex-llvm.sh [install-prefix]` from the repository root. The
script fetches LLVM 20.1.8, builds Clang with only the ARM backend, and installs
the `clang` executable and its builtin headers. It uses all available CPU
threads by default. Set `JOBS`, `LLVM_VERSION`, `LLVM_SOURCE_DIR`, or
`LLVM_WORK_DIR` to change the defaults. The default output is
`.build/vex-llvm/install`.

For the Alpine `vexcode:v1` image, run
`VEX_LLVM_MUSL=1 scripts/build-vex-llvm.sh` on the host. This downloads a
checksum-pinned musl compiler and builds a static Clang at
`.build/vex-llvm/install-musl`. LLVM compilation stays on the host. The VM
only runs `make` when building a VEX program.

To use it in the `vexcode:v1` image, copy `bin/clang` and `lib/clang` from the
install prefix into the image and put that `bin` directory on `PATH`. Keep the
image's C++ runtime libraries available if using the default dynamic build.
The static musl build needs no C++ runtime library in the image. Keep the VEX
SDK at `/sdk` and the GNU ARM tools in the image. VEXcode uses Clang to compile
and `arm-none-eabi-ld`, `objcopy`, `size`, and `ar` afterward. PROS uses
`arm-none-eabi-gcc` and `g++` instead of Clang. The script does not publish or
change the registry image.
