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
  if (command === "battery") {
    const { capacity } = JSON.parse(await body!.text())
    if (!Number.isFinite(capacity) || capacity < 0 || capacity > 100) {
      throw new Error("Capacity must be between 0 and 100")
    }
    if (worker) await rpc(command, { capacity })
    return
  }
  if (!worker) throw new Error("No program loaded")
  await rpc(command)
}
window.addEventListener("pagehide", () => {
  void stopWasm()
})
