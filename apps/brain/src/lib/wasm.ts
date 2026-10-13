type EventHandler = (event: { event: string; payload: any }) => void
let worker: Worker | undefined
let stopping: Promise<void> | undefined
let nextId = 0
const pending = new Map<
  number,
  { resolve(): void; reject(error: Error): void }
>()
let dispatch: EventHandler = () => {}

export function onWasmEvent(handler: EventHandler) {
  dispatch = handler
}
function cleanup(reason = "Simulator stopped") {
  worker?.terminate()
  worker = undefined
  for (const request of pending.values()) request.reject(new Error(reason))
  pending.clear()
}
function rpc(
  command: string,
  data: Record<string, unknown> = {},
  transfer: Transferable[] = [],
) {
  return new Promise<void>((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(
      () => {
        pending.delete(id)
        reject(new Error(`Simulator ${command} timed out`))
        // Stop pthreads before discarding their parent worker.
        if (command === "stop") cleanup("Simulator stop timed out")
        else void stopWasm()
      },
      command === "start" ? 120_000 : 10_000,
    )
    pending.set(id, {
      resolve: () => {
        clearTimeout(timeout)
        resolve()
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    })
    worker!.postMessage({ id, command, ...data }, transfer)
  })
}
export async function stopWasm() {
  if (stopping) return stopping
  if (!worker) return
  stopping = (async () => {
    try {
      await rpc("stop")
    } catch {
      /* A crashed worker may not acknowledge disposal. */
    } finally {
      cleanup()
    }
  })()
  try {
    await stopping
  } finally {
    stopping = undefined
  }
}
export async function wasmRequest(command: string, body?: Blob) {
  if (command === "stop") return stopWasm()
  if (command === "start") {
    if (
      !globalThis.crossOriginIsolated ||
      typeof SharedArrayBuffer === "undefined"
    ) {
      throw new Error(
        "WebAssembly QEMU requires cross-origin isolation. Serve with COOP: same-origin and COEP: require-corp headers.",
      )
    }
    if (!body?.size || body.size > 32 * 1024 * 1024) {
      throw new Error("Program must contain between 1 byte and 32 MiB")
    }
    await stopWasm()
    const program = await body.arrayBuffer()
    worker = new Worker(new URL("./wasm.worker.ts", import.meta.url), {
      type: "module",
    })
    worker.onmessage = ({ data }) => {
      if (data.id !== undefined) {
        const request = pending.get(data.id)
        pending.delete(data.id)
        if (data.error) request?.reject(new Error(data.error))
        else request?.resolve()
      } else if (data.event === "kernel_log") {
        console.debug(new TextDecoder().decode(new Uint8Array(data.payload)))
      } else {
        dispatch(data)
        if (data.event === "brain_exit" || data.event === "brain_error")
          void stopWasm()
      }
    }
    worker.onerror = (event) => {
      dispatch({ event: "brain_error", payload: event.message })
      void stopWasm()
    }
    try {
      await rpc(
        "start",
        {
          program,
          base: new URL(import.meta.env.BASE_URL, location.href).href,
        },
        [program],
      )
    } catch (error) {
      await stopWasm()
      throw error
    }
    return
  }
  if (command === "controller") {
    const state = JSON.parse(await body!.text())
    if (
      ![0, 1].includes(state.controllerId) ||
      !Array.isArray(state.axes) ||
      state.axes.length !== 4 ||
      state.axes.some(
        (axis: unknown) =>
          typeof axis !== "number" ||
          !Number.isInteger(axis) ||
          axis < -127 ||
          axis > 127,
      ) ||
      !Number.isInteger(state.buttons) ||
      state.buttons < 0 ||
      state.buttons > 4095 ||
      !Number.isInteger(state.capacity) ||
      state.capacity < 0 ||
      state.capacity > 100 ||
      typeof state.connected !== "boolean"
    )
      throw new Error("Invalid controller state")
    if (worker) await rpc(command, state)
    return
  }
  if (command === "battery") {
    const {
      capacity,
      voltage = 12000,
      current = 0,
      temperature = 25,
    } = JSON.parse(await body!.text())
    if (!Number.isFinite(capacity) || capacity < 0 || capacity > 100) {
      throw new Error("Capacity must be between 0 and 100")
    }
    if (
      !Number.isInteger(voltage) ||
      voltage < 0 ||
      voltage > 16000 ||
      !Number.isInteger(current) ||
      current < 0 ||
      current > 100000 ||
      !Number.isFinite(temperature) ||
      temperature < -40 ||
      temperature > 100
    )
      throw new Error("Invalid battery voltage, current, or temperature")
    if (worker) await rpc(command, { capacity, voltage, current, temperature })
    return
  }
  if (
    command === "distance" ||
    command === "disconnect" ||
    command === "motor"
  ) {
    const state = JSON.parse(await body!.text())
    if (!Number.isInteger(state.port) || state.port < 1 || state.port > 21)
      throw new Error("Smart port must be between 1 and 21")
    if (
      command === "distance" &&
      (!Number.isInteger(state.distance) ||
        state.distance < 20 ||
        state.distance > 2000 ||
        !Number.isInteger(state.size) ||
        state.size < 0 ||
        state.size > 400 ||
        typeof state.visible !== "boolean")
    )
      throw new Error("Invalid distance sensor state")
    if (!worker) throw new Error("No program loaded")
    await rpc(command, state)
    return
  }
  if (!worker) throw new Error("No program loaded")
  await rpc(command)
}
window.addEventListener("pagehide", () => {
  void stopWasm()
})
