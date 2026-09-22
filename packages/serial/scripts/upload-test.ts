import { existsSync, readFileSync } from "node:fs"
import {
  FileExitAction,
  ProgramIniConfig,
  V5SerialConnection,
} from "../src/index.ts"
import { createBunAdapter } from "../src/adapters/bun.ts"

const root = process.argv[2] ?? "/home/pingu/Work/vex/testing"
const name =
  process.argv[3] ?? root.split("/").filter(Boolean).at(-1) ?? "program"
const hotPath = `${root}/bin/hot.package.bin`
const coldPath = `${root}/bin/cold.package.bin`
const monolithPath = `${root}/bin/monolith.bin`

const useHotCold = existsSync(hotPath) && existsSync(coldPath)
if (!useHotCold && !existsSync(monolithPath)) {
  throw new Error(`No binaries in ${root}/bin`)
}

const hot = new Uint8Array(readFileSync(useHotCold ? hotPath : monolithPath))
const cold = useHotCold ? new Uint8Array(readFileSync(coldPath)) : undefined
console.log(
  root,
  useHotCold
    ? `hot ${hot.byteLength} cold ${cold?.byteLength}`
    : `monolith ${hot.byteLength}`
)

const adapter = createBunAdapter({ path: "/dev/ttyACM0" })
const conn = new V5SerialConnection(adapter)
const opened = await conn.open(0, true)
console.log("opened", opened)
if (opened !== true) {
  throw new Error("Failed to open /dev/ttyACM0")
}

const ini = new ProgramIniConfig()
ini.baseName = "slot_1"
ini.autorun = true
ini.after = FileExitAction.EXIT_RUN
ini.project.ide = "PROS"
ini.program.name = name
ini.program.slot = 0
ini.program.icon = "USER902x.bmp"
ini.program.description = "Created with PROS"
ini.libraryTemplates = ["kernel", "liblvgl"]
ini.setProgramDate(new Date())

const ok = await conn.uploadProgramToDevice(
  ini,
  hot,
  cold,
  (state, current, total) => {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0
    if (pct === 0 || pct === 100 || pct % 25 === 0) {
      console.log(state, current, "/", total, `${pct}%`)
    }
  }
)
console.log("upload result", ok)
await conn.close()
