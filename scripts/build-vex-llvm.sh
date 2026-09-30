#!/usr/bin/env bash
set -euo pipefail

# Build the Clang executable used by the VEXcode makefile. PROS uses GCC.
# Usage: scripts/build-vex-llvm.sh [install-prefix]
# Set VEX_LLVM_MUSL=1 for a portable, static Linux binary suitable for Alpine.
# Override LLVM_VERSION, LLVM_SOURCE_DIR, LLVM_WORK_DIR, or JOBS as needed.

version=${LLVM_VERSION:-20.1.8}
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
work_dir=${LLVM_WORK_DIR:-"$root/.build/vex-llvm"}
source_dir=${LLVM_SOURCE_DIR:-"$work_dir/llvm-project"}
musl=${VEX_LLVM_MUSL:-0}
if [[ $musl == 1 ]]; then
  build_dir="$work_dir/build-musl"
  prefix=${1:-"$work_dir/install-musl"}
else
  build_dir="$work_dir/build"
  prefix=${1:-"$work_dir/install"}
fi
jobs=${JOBS:-$(getconf _NPROCESSORS_ONLN)}

for tool in git cmake ninja c++ python3 strip; do
  command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }
done
[[ $jobs =~ ^[1-9][0-9]*$ ]] || { echo 'JOBS must be a positive integer' >&2; exit 1; }
mkdir -p "$work_dir"
prefix=$(mkdir -p "$prefix" && cd "$prefix" && pwd)

compiler_args=()
if [[ $musl == 1 ]]; then
  for tool in curl sha256sum tar; do
    command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }
  done
  musl_dir="$work_dir/musl-cross"
  musl_archive="$musl_dir/toolchain.tgz"
  musl_bin="$musl_dir/x86_64-linux-musl-cross/bin"
  if [[ ! -x "$musl_bin/x86_64-linux-musl-g++" ]]; then
    mkdir -p "$musl_dir"
    if [[ ! -f "$musl_archive" ]]; then
      curl -fL --retry 3 -o "$musl_archive" \
        https://musl.cc/x86_64-linux-musl-cross.tgz
    fi
    printf '%s  %s\n' \
      'c5d410d9f82a4f24c549fe5d24f988f85b2679b452413a9f7e5f7b956f2fe7ea' \
      "$musl_archive" | sha256sum --check -
    tar -xzf "$musl_archive" -C "$musl_dir"
  fi
  compiler_args=(
    -DCMAKE_C_COMPILER="$musl_bin/x86_64-linux-musl-gcc"
    -DCMAKE_CXX_COMPILER="$musl_bin/x86_64-linux-musl-g++"
    '-DCMAKE_EXE_LINKER_FLAGS=-static -no-pie'
  )
fi

if [[ ! -f "$source_dir/llvm/CMakeLists.txt" ]]; then
  if [[ -e "$source_dir" ]]; then
    echo "LLVM_SOURCE_DIR exists but has no llvm/CMakeLists.txt: $source_dir" >&2
    exit 1
  fi
  git clone --depth 1 --filter=blob:none --sparse --branch "llvmorg-$version" \
    https://github.com/llvm/llvm-project.git "$source_dir"
  git -C "$source_dir" sparse-checkout set cmake llvm clang
fi

cmake -S "$source_dir/llvm" -B "$build_dir" -G Ninja \
  "${compiler_args[@]}" \
  -DCMAKE_BUILD_TYPE=MinSizeRel \
  -DCMAKE_INSTALL_PREFIX="$prefix" \
  -DLLVM_ENABLE_PROJECTS=clang \
  -DLLVM_TARGETS_TO_BUILD=ARM \
  -DLLVM_ENABLE_ASSERTIONS=OFF \
  -DLLVM_INCLUDE_TESTS=OFF \
  -DLLVM_INCLUDE_EXAMPLES=OFF \
  -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DLLVM_INCLUDE_DOCS=OFF \
  -DLLVM_BUILD_TOOLS=OFF \
  -DLLVM_ENABLE_BINDINGS=OFF \
  -DLLVM_ENABLE_ZLIB=OFF \
  -DLLVM_ENABLE_ZSTD=OFF \
  -DLLVM_ENABLE_LIBXML2=OFF \
  -DLLVM_ENABLE_LIBEDIT=OFF \
  -DLLVM_BUILD_LLVM_DYLIB=OFF \
  -DLLVM_LINK_LLVM_DYLIB=OFF \
  -DCLANG_BUILD_TOOLS=OFF \
  -DCLANG_INCLUDE_TESTS=OFF \
  -DCLANG_INCLUDE_DOCS=OFF \
  -DCLANG_ENABLE_STATIC_ANALYZER=OFF \
  -DCLANG_ENABLE_ARCMT=OFF

cmake --build "$build_dir" --target clang --parallel "$jobs"

# Installing the whole LLVM project also installs unused tools and libraries.
# The compiler driver needs only its executable and builtin headers here.
mkdir -p "$prefix/bin"
install -m 755 "$build_dir/bin/clang" "$prefix/bin/clang"
strip --strip-unneeded "$prefix/bin/clang"
resource_dir=$("$build_dir/bin/clang" -print-resource-dir)
mkdir -p "$prefix/lib/clang"
cp -a "$resource_dir" "$prefix/lib/clang/"

"$prefix/bin/clang" -target thumbv7-none-eabi -march=armv7-a \
  -mfpu=neon -mfloat-abi=softfp -x c -c -o "$work_dir/smoke.o" \
  - <<< 'int vex_llvm_smoke(void) { return 42; }'
"$prefix/bin/clang" -target thumbv7-none-eabi -march=armv7-a \
  -mfpu=neon -mfloat-abi=softfp -std=gnu++11 -x c++ -c \
  -o "$work_dir/smoke-cxx.o" - <<< 'int vex_llvm_cxx_smoke() { return 42; }'
echo "Clang installed at $prefix/bin/clang"
