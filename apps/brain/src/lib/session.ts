import { spawnQemu, killQemu } from "~/lib/invoke"
import { desktop, listen, request } from "~/lib/runtime"
import { terminal, session } from "~/lib/stores"
import { get } from "svelte/store"

export default class Session {
  paused = false
  running = false
  private unlisten: (() => void)[] = []
  private ended(error?: string) {
    this.running = false
    this.paused = false
    this.unlisten.splice(0).forEach((fn) => fn())
    if (error) get(terminal)?.writeln(`Simulator failed: ${error}`)
    session.set(this)
  }
  constructor(
    public binary: string,
    private file?: File,
  ) {}
  async start() {
    if (this.running) return
    try {
      if (desktop)
        await spawnQemu({
          gdb: false,
          qemu: "qemu-system-arm",
          kernel: "../../../target/armv7a-none-eabi/debug/kernel",
          binary: this.binary,
          qemu_args: [],
        })
      else {
        this.unlisten.push(
          await listen("brain_exit", () => this.ended()),
          await listen<string>("brain_error", ({ payload }) =>
            this.ended(payload),
          ),
        )
        await request("start", this.file)
      }
      this.running = true
      session.set(this)
    } catch (error) {
      this.unlisten.splice(0).forEach((fn) => fn())
      get(terminal)?.writeln(`Failed to start program: ${error}`)
      throw error
    }
  }
  async stop() {
    if (!this.running) return
    if (desktop) await killQemu()
    else await request("stop")
    this.ended()
    get(terminal)?.clear()
    session.set(this)
  }
  async togglePause() {
    if (!this.running || desktop) return
    await request(this.paused ? "resume" : "pause")
    this.paused = !this.paused
    session.set(this)
  }
  async reset() {
    if (this.running) {
      await this.stop()
      await this.start()
    }
  }
}
