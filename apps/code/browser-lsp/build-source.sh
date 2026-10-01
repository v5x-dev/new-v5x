#!/usr/bin/env bash
# Optional reproducible source build. The normal build uses checksum-pinned assets.
set -euo pipefail
lsp_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lsp_build="$lsp_root/.build/compiler"
mkdir -p "$lsp_build"
if [[ ! -d "$lsp_build/emsdk" ]]; then
  git clone --depth 1 --branch 4.0.22 https://github.com/emscripten-core/emsdk "$lsp_build/emsdk"
fi
"$lsp_build/emsdk/emsdk" install 4.0.22
"$lsp_build/emsdk/emsdk" activate 4.0.22
source "$lsp_build/emsdk/emsdk_env.sh"
if [[ ! -d "$lsp_build/llvm-project" ]]; then
  git clone --depth 1 --branch llvmorg-21.1.0 https://github.com/llvm/llvm-project "$lsp_build/llvm-project"
fi
lsp_llvm="$lsp_build/llvm-project"
if [[ ! -f "$lsp_llvm/.v5x-stdin-patched" ]]; then
  git -C "$lsp_llvm" apply "$lsp_root/wait-stdin.patch"
  touch "$lsp_llvm/.v5x-stdin-patched"
fi
cmake -G Ninja -S "$lsp_llvm/llvm" -B "$lsp_build/native" \
  -DCMAKE_BUILD_TYPE=Release -DLLVM_ENABLE_PROJECTS=clang -DLLVM_INCLUDE_TESTS=OFF
cmake --build "$lsp_build/native" --target llvm-tblgen clang-tblgen --parallel "${LSP_BUILD_JOBS:-2}"
emcmake cmake -G Ninja -S "$lsp_llvm/llvm" -B "$lsp_build/wasm" \
  -DCMAKE_BUILD_TYPE=MinSizeRel \
  -DCMAKE_CXX_FLAGS='-pthread -Dwait4=__syscall_wait4' \
  -DCMAKE_EXE_LINKER_FLAGS='-pthread -s ENVIRONMENT=worker -s NO_INVOKE_RUN -s EXIT_RUNTIME -s INITIAL_MEMORY=268435456 -s ALLOW_MEMORY_GROWTH -s MAXIMUM_MEMORY=4GB -s STACK_SIZE=256kB -s EXPORTED_RUNTIME_METHODS=FS,callMain -s MODULARIZE -s EXPORT_ES6 -s WASM_BIGINT -s ASYNCIFY -s PTHREAD_POOL_SIZE=6' \
  -DLLVM_TARGET_ARCH=wasm32-emscripten -DLLVM_DEFAULT_TARGET_TRIPLE=arm-none-eabi \
  -DLLVM_TARGETS_TO_BUILD=ARM -DLLVM_ENABLE_PROJECTS='clang;clang-tools-extra' \
  -DLLVM_TABLEGEN="$lsp_build/native/bin/llvm-tblgen" \
  -DCLANG_TABLEGEN="$lsp_build/native/bin/clang-tblgen" \
  -DLLVM_BUILD_STATIC=ON -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_TESTS=OFF \
  -DLLVM_ENABLE_BACKTRACES=OFF -DLLVM_ENABLE_UNWIND_TABLES=OFF \
  -DLLVM_ENABLE_CRASH_OVERRIDES=OFF -DCLANG_ENABLE_STATIC_ANALYZER=OFF \
  -DLLVM_ENABLE_TERMINFO=OFF -DLLVM_ENABLE_PIC=OFF -DLLVM_ENABLE_ZLIB=OFF \
  -DLLVM_ENABLE_ZSTD=OFF -DCLANG_ENABLE_ARCMT=OFF
cmake --build "$lsp_build/wasm" --target clangd --parallel "${LSP_BUILD_JOBS:-2}"
cp "$lsp_build/wasm/bin/clangd.js" "$lsp_root/../public/lsp/v1/clangd.js"
cp "$lsp_build/wasm/bin/clangd.wasm" "$lsp_root/../public/lsp/v1/clangd.wasm"
# Update the content hashes consumed by both the loader and build preparation.
bun "$lsp_root/register-source-build.ts"
