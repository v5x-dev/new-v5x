#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
emulator="$repo_root/emulator"
cd "$emulator"
build_root="$emulator/target/wasm-build"
output="$repo_root/apps/brain/public/wasm"
mkdir -p "$build_root" "$output"

# Both the Rust crate and CLI must use the same wasm-bindgen release.
rustup target add wasm32-unknown-unknown
if ! command -v wasm-bindgen >/dev/null || [[ $(wasm-bindgen --version) != 'wasm-bindgen 0.2.100' ]]; then
    cargo +stable install wasm-bindgen-cli --version 0.2.100 --locked
fi
cargo build --locked -p vex-v5-wasm-host --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir "$output" \
    target/wasm32-unknown-unknown/release/vex_v5_wasm_host.wasm
(cd kernel; cargo build --locked)
cp kernel/target/armv7a-none-eabi/debug/kernel "$output/kernel.elf"

if [[ ! -f "$build_root/qemu.tar.xz" ]]; then
    curl -Lf https://download.qemu.org/qemu-10.1.0.tar.xz -o "$build_root/qemu.tar.xz"
fi
echo "e0517349b50ca73ebec2fa85b06050d5c463ca65c738833bd8fc1f15f180be51  $build_root/qemu.tar.xz" | sha256sum -c -
# Always extract a clean tree so the overlay is not applied twice.
tar -xJf "$build_root/qemu.tar.xz" -C "$build_root"
if [[ ${V5_WASM_LOCAL:-0} == 1 ]]; then
    for tool in emcc meson ninja pkg-config; do
        command -v "$tool" >/dev/null || { echo "Missing $tool. Activate Emscripten 3.1.50 and install Meson 1.5.0." >&2; exit 1; }
    done
    "$repo_root/tools/wasm/build-deps.sh" "$build_root"
    python3 "$repo_root/tools/wasm/patch-qemu.py" "$build_root/qemu-10.1.0"
    export CPATH="$build_root/deps/include"
    export PKG_CONFIG_PATH="$build_root/deps/lib/pkgconfig"
    export PKG_CONFIG_LIBDIR="$PKG_CONFIG_PATH"
    export EM_PKG_CONFIG_PATH="$PKG_CONFIG_PATH"
    export LDFLAGS="-L$build_root/deps/lib"
    mkdir -p "$build_root/qemu-build"
    (cd "$build_root/qemu-build"; emconfigure ../qemu-10.1.0/configure \
        --static --target-list=arm-softmmu --without-default-features \
        --enable-system --enable-tcg-interpreter --disable-tools --disable-docs \
        --disable-pie --extra-cflags=-O3; ninja -j4 qemu-system-arm.js)
    cp "$build_root/qemu-build"/qemu-system-arm.{js,wasm,worker.js} "$output/"
else
    # Upstream's old zlib URL moved to the fossils archive.
    sed 's@https://zlib.net/zlib-@https://zlib.net/fossils/zlib-@' \
        "$build_root/qemu-10.1.0/tests/docker/dockerfiles/emsdk-wasm32-cross.docker" \
        > "$build_root/Dockerfile.deps"
    docker build --progress=plain -t vex-v5-qemu-wasm-deps \
        - < "$build_root/Dockerfile.deps"
    mkdir -p "$build_root/overlay"
    cp "$repo_root/tools/wasm/patch-qemu.py" "$repo_root/tools/wasm/v5-bridge.c" "$build_root/overlay/"
    printf '**\n!qemu-10.1.0/\n!qemu-10.1.0/**\n!overlay/\n!overlay/**\n' > "$build_root/.dockerignore"
    docker build --progress=plain -f "$repo_root/tools/wasm/Dockerfile" \
        --output "type=local,dest=$output" "$build_root"
fi
cp "$build_root/qemu-10.1.0/COPYING" "$output/QEMU-COPYING"
echo "Wasm artifacts are ready in $output"
