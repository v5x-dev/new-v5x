#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cache_root=${XDG_CACHE_HOME:-"${HOME:?HOME must be set}/.cache"}
work_root=${V5X_TOOLCHAIN_WORKDIR:-"$cache_root/v5x/microbit-clang-wasm-21.11.0-alpha.1-reduced"}
upstream_dir=${V5X_UPSTREAM_SOURCE_DIR:-"$work_root/microbit-clang-wasm"}
llvm_dir=${V5X_LLVM_SOURCE_DIR:-"$work_root/llvm-src"}
package_commit=8bae55227c1573c7cbd9cb530bbe447d1521131a
llvm_commit=0bac08d50952133963671eeeb8c3e67695a32f49
patch_file="$repository_root/scripts/toolchain-build/reduced-llvm.patch"
jobs=${JOBS:-6}

if [[ ! $jobs =~ ^[1-6]$ ]]; then
  echo 'JOBS must be between 1 and 6; the build is capped at 8 GB RAM with swap disabled' >&2
  exit 1
fi

if [[ ${V5X_TOOLCHAIN_MEMORY_LIMITED:-0} != 1 ]]; then
  command -v systemd-run >/dev/null || {
    echo 'systemd-run is required to enforce the 8 GB build memory cap' >&2
    exit 1
  }
  exec systemd-run --user --scope \
    --property=MemoryMax=8G \
    --property=MemorySwapMax=0 \
    --setenv=V5X_TOOLCHAIN_MEMORY_LIMITED=1 \
    --setenv=JOBS="$jobs" \
    --setenv=V5X_TOOLCHAIN_WORKDIR="$work_root" \
    --setenv=V5X_UPSTREAM_SOURCE_DIR="$upstream_dir" \
    --setenv=V5X_LLVM_SOURCE_DIR="$llvm_dir" \
    -- bash "$repository_root/scripts/toolchain-build/build-reduced.sh" "$@"
fi

for tool in git curl sha256sum tar cmake ninja python3; do
  command -v "$tool" >/dev/null || {
    echo "Missing build tool: $tool" >&2
    exit 1
  }
done

mkdir -p "$work_root"

if [[ ! -d "$upstream_dir/.git" ]]; then
  git clone --depth 1 --branch v0-alpha.1 \
    https://github.com/carlosperate/microbit-clang-wasm.git "$upstream_dir"
fi

if [[ $(git -C "$upstream_dir" rev-parse HEAD) != "$package_commit" ]]; then
  echo "Expected microbit-clang-wasm commit $package_commit in $upstream_dir" >&2
  exit 1
fi

if git -C "$upstream_dir" apply --check "$patch_file" >/dev/null 2>&1; then
  git -C "$upstream_dir" apply "$patch_file"
elif git -C "$upstream_dir" apply --check --reverse "$patch_file" >/dev/null 2>&1; then
  echo 'Reduced-build patch is already applied'
else
  echo "The reduced-build patch does not match upstream build.sh" >&2
  exit 1
fi

if [[ ! -d "$llvm_dir/llvm" ]]; then
  git clone --depth 1 --single-branch --branch release-21.1.1-ATfE \
    https://github.com/arm/arm-toolchain.git "$llvm_dir"
fi

if [[ $(git -C "$llvm_dir" rev-parse HEAD) != "$llvm_commit" ]]; then
  echo "Expected Arm LLVM commit $llvm_commit in $llvm_dir" >&2
  exit 1
fi

if [[ ! -e "$upstream_dir/llvm-src" ]]; then
  ln -s "$llvm_dir" "$upstream_dir/llvm-src"
fi

arm_version=21.1.1
arm_release="ATfE-$arm_version-Linux-x86_64"
arm_overlay="ATfE-newlib-nano-overlay-$arm_version"
arm_assets="$work_root/arm-toolchain"
arm_install="$arm_assets/unpacked/$arm_release"
arm_base_url="https://github.com/arm/arm-toolchain/releases/download/release-$arm_version-ATfE"

if [[ ! -d "$arm_install/lib/clang-runtimes" ]]; then
  mkdir -p "$arm_assets"
  for name in "$arm_release.tar.xz" "$arm_release.tar.xz.sha256" \
    "$arm_overlay.tar.xz" "$arm_overlay.tar.xz.sha256"; do
    if [[ ! -s "$arm_assets/$name" ]]; then
      curl -fL --retry 3 -o "$arm_assets/$name.part" "$arm_base_url/$name"
      mv "$arm_assets/$name.part" "$arm_assets/$name"
    fi
  done

  (
    cd "$arm_assets"
    sha256sum --check "$arm_release.tar.xz.sha256"
    sha256sum --check "$arm_overlay.tar.xz.sha256"
  )

  mkdir -p "$arm_assets/unpacked"
  tar -xJf "$arm_assets/$arm_release.tar.xz" -C "$arm_assets/unpacked"
  tar -xJf "$arm_assets/$arm_overlay.tar.xz" -C "$arm_assets/unpacked/$arm_release"
  rm "$arm_assets/$arm_release.tar.xz" "$arm_assets/$arm_overlay.tar.xz"
fi

sysroot="$upstream_dir/atfe-sysroot"
if [[ ! -d "$sysroot/include" || ! -d "$sysroot/lib" || ! -d "$sysroot/licenses" ]]; then
  "$upstream_dir/atfe-sysroot.sh" "$arm_assets/unpacked/$arm_release" "$sysroot"
fi

cd "$upstream_dir"
export CMAKE_GENERATOR=Ninja
export CMAKE_BUILD_PARALLEL_LEVEL="$jobs"
export MAKEFLAGS="-j$jobs"
export ATFE_SYSROOT="$sysroot"

echo "Building reduced LLVM WASM toolchain with $jobs build jobs in $upstream_dir"
STAGE=all ./build.sh "$arm_version"
echo "Reduced LLVM WASM executable: $upstream_dir/llvm-build/bin/llvm"
