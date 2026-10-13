import { access } from "node:fs/promises"
import { createRequire } from "node:module"
import { expect } from "bun:test"
import packageJson from "../package.json"

// Verify the published paths, not source aliases. Native adapters are checked
// for packaging here; opening their hardware is a separate acceptance task.
for (const conditions of Object.values(packageJson.exports)) {
  for (const path of Object.values(conditions)) {
    await access(new URL(`../${path}`, import.meta.url))
  }
}

const esm = await import("@v5x/serial")
const packets = await import("@v5x/serial/packet-core")
const browser = await import("@v5x/serial/browser")
const bluetooth = await import("@v5x/serial/bluetooth")
const require = createRequire(import.meta.url)
const cjs = require("@v5x/serial")
const cjsPackets = require("@v5x/serial/packet-core")

expect(esm.USER_FLASH_USR_CODE_START).toBe(0x03800000)
expect(cjs.USER_FLASH_USR_CODE_START).toBe(esm.USER_FLASH_USR_CODE_START)
expect(typeof packets.PacketView).toBe("function")
expect(typeof cjsPackets.PacketView).toBe("function")
expect(typeof browser.createBrowserAdapter).toBe("function")
expect(typeof bluetooth.createBluetoothAdapter).toBe("function")
console.log("Serial package exports verified")
