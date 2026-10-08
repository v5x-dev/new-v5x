import { onWasmEvent, wasmRequest } from "./wasm"

export const desktop = false
const listeners = new Map<string, Set<(event: { payload: any }) => void>>()
onWasmEvent((message) => {
  listeners.get(message.event)?.forEach((fn) => fn(message))
})
export async function listen<T>(
  name: string,
  callback: (event: { payload: T }) => void,
): Promise<() => void> {
  const group = listeners.get(name) ?? new Set()
  listeners.set(name, group)
  group.add(callback)
  return () => {
    group.delete(callback)
    if (!group.size) listeners.delete(name)
  }
}
export async function request(path: string, body?: Blob) {
  await wasmRequest(path, body)
}
