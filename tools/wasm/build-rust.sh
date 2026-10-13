#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
output="$repo_root/apps/brain/public/wasm"
cd "$repo_root/emulator"
mkdir -p "$output"
rustup target add wasm32-unknown-unknown
if ! command -v wasm-bindgen >/dev/null || [[ $(wasm-bindgen --version) != 'wasm-bindgen 0.2.100' ]]; then
    cargo +stable install wasm-bindgen-cli --version 0.2.100 --locked
fi
cargo build --locked -p vex-v5-wasm-host --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir "$output" \
    target/wasm32-unknown-unknown/release/vex_v5_wasm_host.wasm
(cd kernel; cargo build --locked)
cp kernel/target/armv7a-none-eabi/debug/kernel "$output/kernel.elf"
bun "$repo_root/tools/wasm/artifact-manifest.mjs" --write
