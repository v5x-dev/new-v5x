import { expect, test } from "bun:test"
import { V5SerialConnection } from "./vex-connection"

test("opens, closes, and reopens an adapter port", async () => {
  let readable: ReadableStream<Uint8Array> | null = null
  let writable: WritableStream<Uint8Array> | null = null
  let disconnect: (() => void) | undefined

  const port = {
    get readable() {
      return readable
    },
    get writable() {
      return writable
    },
    getInfo: () => ({ usbVendorId: 10376, usbProductId: 1281 }),
    open: async () => {
      readable = new ReadableStream<Uint8Array>()
      writable = new WritableStream<Uint8Array>()
    },
    close: async () => {
      readable = null
      writable = null
    },
    addEventListener: (_type: "disconnect", listener: () => void) => {
      disconnect = listener
    },
    removeEventListener: () => {
      disconnect = undefined
    },
  }

  const connection = new V5SerialConnection({
    getPorts: async () => [port],
    requestPort: async () => port,
  })
  let connectedState = false
  connection.on("connected", () => {
    connectedState = connection.isConnected
  })

  expect(await connection.open(0, false)).toBe(true)
  expect(connectedState).toBe(true)
  await connection.close()
  expect(connection.isConnected).toBe(false)

  expect(await connection.open(0, false)).toBe(true)
  expect(connection.isConnected).toBe(true)
  disconnect?.()
  for (let i = 0; i < 100 && connection.isConnected; i++) await Bun.sleep(0)
  expect(connection.isConnected).toBe(false)
})
