#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cache_root=${XDG_CACHE_HOME:-"${HOME:?HOME must be set}/.cache"}
work_root=${V5X_TOOLCHAIN_WORKDIR:-"$cache_root/v5x/microbit-clang-wasm-21.11.0-alpha.1-reduced"}
upstream_dir=${V5X_UPSTREAM_SOURCE_DIR:-"$work_root/microbit-clang-wasm"}
package_dir="$upstream_dir/npmjs"

if [[ ${V5X_TOOLCHAIN_MEMORY_LIMITED:-0} != 1 ]]; then
  command -v systemd-run >/dev/null || {
    echo 'systemd-run is required to enforce the 8 GB packaging memory cap' >&2
    exit 1
  }
  exec systemd-run --user --scope \
    --property=MemoryMax=8G \
    --property=MemorySwapMax=0 \
    --setenv=V5X_TOOLCHAIN_MEMORY_LIMITED=1 \
    --setenv=V5X_TOOLCHAIN_WORKDIR="$work_root" \
    --setenv=V5X_UPSTREAM_SOURCE_DIR="$upstream_dir" \
    -- bash "$repository_root/scripts/toolchain-build/package-reduced.sh" "$@"
fi

for tool in bun python3; do
  command -v "$tool" >/dev/null || {
    echo "Missing build tool: $tool" >&2
    exit 1
  }
done

if [[ ! -x "$upstream_dir/llvm-build/bin/llvm" ]]; then
  echo "Build the reduced LLVM executable first: $upstream_dir/llvm-build/bin/llvm" >&2
  exit 1
fi

cp "$upstream_dir/LICENSE.txt" "$upstream_dir/LICENSES" "$package_dir/"

(
  cd "$package_dir"
  python3 prepare.py
  bun install
  bun run transpile
  bun run pack
  bun run build
)

bun "$repository_root/scripts/toolchain-build/smoke-reduced.mjs" "$package_dir"

echo 'Reduced WASM compiler modules:'
du -h "$package_dir"/gen/llvm.core*.wasm
