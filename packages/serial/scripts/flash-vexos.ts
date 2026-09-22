import { V5SerialConnection, V5SerialDevice } from "../src/index.ts"
import { createBunAdapter } from "../src/adapters/bun.ts"

const adapter = createBunAdapter({ path: "/dev/ttyACM0" })
const conn = new V5SerialConnection(adapter)
if ((await conn.open(0, true)) !== true) {
  throw new Error("Failed to open /dev/ttyACM0")
}

const device = new V5SerialDevice(adapter)
device.autoRefresh = false
device.autoReconnect = false
device.connection = conn

console.log("flashing official VEXos from content.vexrobotics.com")
const ok = await device.brain.uploadFirmware(
  "https://content.vexrobotics.com/vexos/public/V5/",
  undefined,
  (state, current, total) => {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0
    if (pct === 0 || pct === 100 || pct % 10 === 0) {
      console.log(state, current, "/", total, `${pct}%`)
    }
  }
)
console.log("uploadFirmware result", ok)
await conn.close()
