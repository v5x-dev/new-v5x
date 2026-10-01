# VEX LLVM build

Run `scripts/build-vex-llvm.sh [install-prefix]` from the repository root. The
script fetches LLVM 20.1.8, builds Clang with only the ARM backend, and installs
the `clang` executable and its builtin headers. It uses all available CPU
threads by default. Set `JOBS`, `LLVM_VERSION`, `LLVM_SOURCE_DIR`, or
`LLVM_WORK_DIR` to change the defaults. The default output is
`.build/vex-llvm/install`.

For a new Alpine VEX build image, run
`VEX_LLVM_MUSL=1 scripts/build-vex-llvm.sh` on the host. This downloads a
checksum-pinned musl compiler and builds a static Clang at
`.build/vex-llvm/install-musl`. LLVM compilation stays on the host. The image
keeps the VEX SDK at `/sdk` and the GNU ARM tools. VEXcode uses Clang plus
`arm-none-eabi-ld`, `objcopy`, `size`, and `ar`; PROS uses `arm-none-eabi-gcc`
and `g++`.

## Build the VEXcode v2 image

Start with the unpacked VEX build rootfs used for v1. Install the custom Clang
from the host build into that source rootfs, then create a trimmed v2 rootfs
with the pinned PROS and EZ Template dependencies already unpacked:

```bash
VEX_LLVM_PREFIX=.build/vex-llvm/install-musl
VEX_BASE_ROOTFS=.build/vexcode-slim/rootfs
VEX_SOURCE_ROOTFS=.build/vexcode-v2/source-rootfs
VEX_IMAGE_ROOTFS=.build/vexcode-v2/rootfs

mkdir -p .build/vexcode-v2
cp -a "$VEX_BASE_ROOTFS" "$VEX_SOURCE_ROOTFS"
install -D -m 755 "$VEX_LLVM_PREFIX/bin/clang" \
  "$VEX_SOURCE_ROOTFS/usr/local/bin/clang"
mkdir -p "$VEX_SOURCE_ROOTFS/usr/local/lib/clang"
cp -a "$VEX_LLVM_PREFIX/lib/clang/." \
  "$VEX_SOURCE_ROOTFS/usr/local/lib/clang/"

python3 scripts/trim-vex-rootfs.py \
  "$VEX_SOURCE_ROOTFS" "$VEX_IMAGE_ROOTFS"
python3 scripts/install-vex-build-assets.py "$VEX_IMAGE_ROOTFS"
```

The installer verifies the PROS kernel 3.8.3 and EZ Template 3.2.2 archives,
then places their extracted files under `/opt/vex-build`. The Convex action
copies those files into each project workspace. Older images still use the
checksum-verified download path.

Create and package the candidate image:

```bash
VEX_IMAGE_ROOTFS="$(realpath "$VEX_IMAGE_ROOTFS")"
smolvm machine create --name vexcode-v2 \
  --image "$VEX_IMAGE_ROOTFS" --cpus 2 --mem 2048 --net
smolvm machine start --name vexcode-v2
# Test clean VEXcode, PROS, and EZ Template builds in the VM.
smolvm machine stop --name vexcode-v2
smol pack create --from-vm vexcode-v2 \
  --output .build/vexcode-v2.smolmachine --cpus 2 --mem 2048
```

After validating the candidate, publish it to the tenant registry and set
`VEXCODE_IMAGE_TAG=v2` in the Convex deployment:

```bash
smol pack push --file .build/vexcode-v2.smolmachine \
  "registry.smolmachines.com/${REGISTRY_NAMESPACE}/vexcode:v2"
```

The Convex build action uses `v1` when `VEXCODE_IMAGE_TAG` is unset. It runs
`make -j2` for PROS and EZ Template projects and plain `make` for VEXcode.

## Smaller V5 image

Run `python3 scripts/trim-vex-rootfs.py SOURCE_ROOTFS DESTINATION_ROOTFS`
on the host to copy and trim an unpacked image containing the custom Clang.
The destination must not exist. It removes the native GCC compiler, unused
ARM multilib variants, and documentation. It keeps the default ARM libraries
and `thumb/v7+fp/softfp`, selected by PROS's Cortex-A9 flags. Other ARM targets
and float ABIs require a full image. APK's database is retained for provenance;
package repair or upgrades can reinstall trimmed files.

The v2 image recipe above trims the rootfs before it installs these build
assets. Use the full rootfs instead if builds need another ARM target or float
ABI.
