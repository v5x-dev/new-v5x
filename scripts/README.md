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

## Smaller V5 image

Run `python3 scripts/trim-vex-rootfs.py SOURCE_ROOTFS DESTINATION_ROOTFS`
on the host to copy and trim an unpacked image containing the custom Clang.
The destination must not exist. It removes the native GCC compiler, unused
ARM multilib variants, and documentation. It keeps the default ARM libraries
and `thumb/v7+fp/softfp`, selected by PROS's Cortex-A9 flags. Other ARM targets
and float ABIs require a full image. APK's database is retained for provenance;
package repair or upgrades can reinstall trimmed files.

Create a separate machine with `smolvm machine create --name vexcode-slim
--image ABSOLUTE_DESTINATION_ROOTFS --cpus 2 --mem 2048 --net`, start and stop
it once, then package it with `smol pack create --from-vm vexcode-slim
--output .build/vexcode-slim.smolmachine --cpus 2 --mem 2048`.
Test clean VEXcode, PROS, and EZ Template builds before publishing.

The Convex build action accepts `VEXCODE_IMAGE_TAG` to test a candidate tag
on the development deployment. When unset, it uses `v1`.
