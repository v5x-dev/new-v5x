import { access } from "node:fs/promises"
const files = [
  "qemu-system-arm.js",
  "qemu-system-arm.wasm",
  "qemu-system-arm.worker.js",
  "vex_v5_wasm_host.js",
  "vex_v5_wasm_host_bg.wasm",
  "kernel.elf",
  "QEMU-COPYING",
]
for (const name of files) {
  try {
    await access(new URL(`../public/wasm/${name}`, import.meta.url))
  } catch {
    throw new Error(
      `Missing Wasm artifact ${name}. Run npm run wasm:build first.`,
    )
  }
}
