import { list, SerialPort } from "bun-serialport"
import { createByteStreams } from "./byte-streams"
import {
  type AdapterSerialPort,
  parseUsbId,
  portMatchesFilters,
  type RequestPortOptions,
  type SerialAdapter,
  type SerialPortInfo,
} from "./serial-adapter"

export type BunAdapterOptions = {
  path?: string
}

type ListedSerialPort = {
  path: string
  vendorId?: string
  productId?: string
}

async function enrichPortList(
  ports: ListedSerialPort[]
): Promise<ListedSerialPort[]> {
  // bun-serialport normally supplies USB metadata, but older versions can
  // return only the device path on Linux. The native serialport package is an
  // optional peer, so keep the Bun adapter usable when it is not installed.
  try {
    const { SerialPort: NativeSerialPort } = await import("serialport")
    const details = await NativeSerialPort.list()
    const byPath = new Map(details.map((port) => [port.path, port]))
    return ports.map((port) => {
      const detail = byPath.get(port.path)
      return detail === undefined
        ? port
        : {
            ...port,
            vendorId: port.vendorId ?? detail.vendorId ?? undefined,
            productId: port.productId ?? detail.productId ?? undefined,
          }
    })
  } catch {
    return ports
  }
}

class BunSerialPort implements AdapterSerialPort {
  #info: SerialPortInfo
  #port: SerialPort | undefined
  #readable: ReadableStream<Uint8Array> | null = null
  #writable: WritableStream<Uint8Array> | null = null
  #onDisconnect?: () => void

  constructor(info: SerialPortInfo) {
    this.#info = info
  }

  get readable(): ReadableStream<Uint8Array> | null {
    return this.#readable
  }

  get writable(): WritableStream<Uint8Array> | null {
    return this.#writable
  }

  getInfo(): SerialPortInfo {
    return this.#info
  }

  async open(options: { baudRate: number }): Promise<void> {
    if (this.#info.path === undefined) {
      throw new Error("Serial port path is missing.")
    }
    const port = new SerialPort({
      path: this.#info.path,
      baudRate: options.baudRate,
      autoOpen: false,
    })
    await port.open()
    this.#port = port

    const streams = createByteStreams({
      write: async (data) => {
        await port.write(data)
      },
      subscribe: (onData, onError, onClose) => {
        const data = (chunk: Uint8Array) => onData(chunk)
        const error = (err: Error & { disconnected?: boolean }) => {
          if (err.disconnected) this.#onDisconnect?.()
          onError(err)
        }
        const close = (err?: Error & { disconnected?: boolean }) => {
          if (err?.disconnected) this.#onDisconnect?.()
          onClose()
        }
        port.on("data", data)
        port.on("error", error)
        port.on("close", close)
        return () => {
          port.off("data", data)
          port.off("error", error)
          port.off("close", close)
        }
      },
    })

    this.#readable = streams.readable
    this.#writable = streams.writable
  }

  async close(): Promise<void> {
    if (this.#port?.isOpen) await this.#port.close()
    this.#port = undefined
    this.#readable = null
    this.#writable = null
  }

  addEventListener(type: "disconnect", listener: () => void): void {
    if (type === "disconnect") this.#onDisconnect = listener
  }

  removeEventListener(type: "disconnect", listener: () => void): void {
    if (type === "disconnect" && this.#onDisconnect === listener) {
      this.#onDisconnect = undefined
    }
  }
}

export function createBunAdapter(
  options: BunAdapterOptions = {}
): SerialAdapter {
  const listed = async (): Promise<BunSerialPort[]> => {
    const ports = await enrichPortList(await list())
    return ports
      .filter(
        (port) => options.path === undefined || port.path === options.path
      )
      .map(
        (port) =>
          new BunSerialPort({
            path: port.path,
            usbVendorId: parseUsbId(port.vendorId),
            usbProductId: parseUsbId(port.productId),
          })
      )
  }

  return {
    getPorts: listed,
    async requestPort(request?: RequestPortOptions) {
      const ports = await listed()
      const path = request?.path ?? options.path
      const match = ports.find((port) => {
        const info = port.getInfo()
        if (path !== undefined && info.path !== path) return false
        return portMatchesFilters(info, request?.filters)
      })
      if (match === undefined) {
        throw new Error("No serial port matched the request.")
      }
      return match
    },
  }
}
