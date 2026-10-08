/// <reference lib="webworker" />

// QEMU's main loop runs on Emscripten pthreads. This parent worker keeps polling
// its shared UART memory, including while the guest is busy or paused.
// The guest kernel and display renderer are from vexide/vex-v5-qemu.
// Maintainer credits are at /credits.html.
const scope = self as unknown as DedicatedWorkerGlobalScope
const INPUT_SIZE = 65536
const OUTPUT_SIZE = 4 * 1024 * 1024
interface QemuModule {
  HEAPU8: Uint8Array
  _v5_bridge(): number
  FS: { writeFile(path: string, data: Uint8Array): void }
  PThread: { terminateAllThreads(): void }
}
interface Host {
  push(bytes: Uint8Array): { event: string; payload: number[] }[]
  take_frame(): Uint8Array | undefined
  battery(capacity: number): Uint8Array
  free(): void
}
let qemu: QemuModule | undefined
let host: Host | undefined
let bridge = 0
let timer: ReturnType<typeof setInterval> | undefined
let stopped = false
let control: { id: number; pause: number } | undefined
let startId: number | undefined

function reply(id: number, error?: string) {
  scope.postMessage({ id, error })
}
function emit(event: string, payload: unknown, transfer: Transferable[] = []) {
  scope.postMessage({ event, payload }, transfer)
}
function dispose() {
  stopped = true
  clearInterval(timer)
  qemu?.PThread.terminateAllThreads()
  host?.free()
  host = undefined
  qemu = undefined
}
function fail(reason: unknown) {
  const error = String(reason)
  if (startId !== undefined) reply(startId, error)
  if (control) reply(control.id, error)
  emit("brain_error", error)
  dispose()
}
function meta() {
  return new Int32Array(qemu!.HEAPU8.buffer, bridge, 8)
}
function poll() {
  if (!qemu || !host || stopped) return
  try {
    const state = meta()
    let read = Atomics.load(state, 2) >>> 0
    const write = Atomics.load(state, 3) >>> 0
    // Copy before freeing ring space. Rust owns incomplete packet fragments.
    if (read !== write) {
      const length = (write - read) >>> 0
      const bytes = new Uint8Array(length)
      const offset = read % OUTPUT_SIZE
      const first = Math.min(length, OUTPUT_SIZE - offset)
      const memory = qemu.HEAPU8
      const output = bridge + 32 + INPUT_SIZE
      bytes.set(memory.subarray(output + offset, output + offset + first))
      if (first < length)
        bytes.set(memory.subarray(output, output + length - first), first)
      read = write
      Atomics.store(state, 2, read)
      for (const event of host.push(bytes)) {
        emit(event.event, event.payload)
      }
      const frame = host.take_frame()
      if (frame)
        emit("brain_display_frame", frame, [frame.buffer as ArrayBuffer])
    }
    if (startId !== undefined && Atomics.load(state, 6)) {
      reply(startId)
      startId = undefined
    }
    if (control && Atomics.load(state, 5) === control.pause) {
      reply(control.id)
      control = undefined
    }
  } catch (error) {
    fail(error)
  }
}
function send(bytes: Uint8Array) {
  const state = meta()
  const read = Atomics.load(state, 0) >>> 0
  const write = Atomics.load(state, 1) >>> 0
  if (bytes.length > INPUT_SIZE - ((write - read) >>> 0)) {
    throw new Error("Guest UART input queue is full")
  }
  const offset = write % INPUT_SIZE
  const first = Math.min(bytes.length, INPUT_SIZE - offset)
  qemu!.HEAPU8.set(bytes.subarray(0, first), bridge + 32 + offset)
  qemu!.HEAPU8.set(bytes.subarray(first), bridge + 32)
  Atomics.store(state, 1, write + bytes.length)
}
async function start(id: number, program: ArrayBuffer, base: string) {
  startId = id
  if (!program.byteLength || program.byteLength > 32 * 1024 * 1024) {
    throw new Error("Program must contain between 1 byte and 32 MiB")
  }
  const asset = (name: string) => new URL(`wasm/${name}`, base).href
  const load = async (name: string) => {
    const response = await fetch(asset(name))
    if (!response.ok)
      throw new Error(
        `Missing ${name}. Run npm run wasm:build before starting the simulator.`,
      )
    return new Uint8Array(await response.arrayBuffer())
  }
  const [kernel, hostModule, qemuModule] = await Promise.all([
    load("kernel.elf"),
    import(/* @vite-ignore */ asset("vex_v5_wasm_host.js")),
    import(/* @vite-ignore */ asset("qemu-system-arm.js")),
  ])
  await hostModule.default({
    module_or_path: asset("vex_v5_wasm_host_bg.wasm"),
  })
  host = new hostModule.BrowserHost()
  qemu = await qemuModule.default({
    locateFile: (name: string) => asset(name),
    mainScriptUrlOrBlob: asset("qemu-system-arm.js"),
    arguments: [
      "-machine",
      "xilinx-zynq-a9",
      "-cpu",
      "cortex-a9",
      "-m",
      "256M",
      "-accel",
      "tcg,thread=single",
      "-icount",
      "shift=3,align=off,sleep=on",
      "-device",
      "loader,addr=0x200,data=0,data-len=4,cpu-num=0",
      "-device",
      "loader,file=/kernel.elf,addr=0x100000,cpu-num=0",
      "-device",
      "loader,file=/program.bin,force-raw=on,addr=0x03800000",
      "-display",
      "none",
      "-monitor",
      "none",
      "-nic",
      "none",
      "-semihosting-config",
      "enable=on,target=native",
      "-chardev",
      "ringbuf,id=v5-uart",
      "-serial",
      "null",
      "-serial",
      "chardev:v5-uart",
    ],
    preRun: [
      (module: QemuModule) => {
        module.FS.writeFile("/kernel.elf", kernel)
        module.FS.writeFile("/program.bin", new Uint8Array(program))
      },
    ],
    print: (line: string) =>
      emit("kernel_log", new TextEncoder().encode(line + "\n")),
    printErr: (line: string) =>
      emit("kernel_log", new TextEncoder().encode(line + "\n")),
    onAbort: (reason: unknown) => fail(reason),
    onExit: (code: number) => {
      if (startId !== undefined)
        fail(`QEMU exited during startup with code ${code}`)
      else emit("brain_exit", code)
    },
  })
  bridge = qemu!._v5_bridge()
  timer = setInterval(poll, 8)
}
scope.onmessage = async ({ data }) => {
  const { id, command } = data
  try {
    if (command === "start") {
      await start(id, data.program, data.base)
      return
    }
    if (command === "stop") {
      dispose()
      reply(id)
      return
    }
    if (!qemu || stopped) throw new Error("No program loaded")
    if (command === "pause" || command === "resume") {
      if (control) throw new Error("A pause/resume request is already pending")
      control = { id, pause: command === "pause" ? 1 : 0 }
      Atomics.store(meta(), 4, control.pause)
      return
    }
    if (command === "battery") send(host!.battery(data.capacity))
    else throw new Error(`Unknown simulator command: ${command}`)
    reply(id)
  } catch (error) {
    if (command === "start") fail(error)
    else reply(id, String(error))
  }
}
