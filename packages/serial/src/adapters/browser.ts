import type {
  AdapterSerialPort,
  RequestPortOptions,
  SerialAdapter,
  SerialPortInfo,
} from "./serial-adapter"

class BrowserSerialPort implements AdapterSerialPort {
  #port: SerialPort
  #disconnectListeners = new Set<() => void>()

  constructor(port: SerialPort) {
    this.#port = port
    this.#port.addEventListener("disconnect", () => {
      for (const listener of this.#disconnectListeners) listener()
    })
  }

  get readable(): ReadableStream<Uint8Array> | null {
    return this.#port.readable as ReadableStream<Uint8Array> | null
  }

  get writable(): WritableStream<Uint8Array> | null {
    return this.#port.writable as WritableStream<Uint8Array> | null
  }

  getInfo(): SerialPortInfo {
    const info = this.#port.getInfo()
    return {
      usbVendorId: info.usbVendorId,
      usbProductId: info.usbProductId,
    }
  }

  open(options: { baudRate: number }): Promise<void> {
    return this.#port.open(options)
  }

  close(): Promise<void> {
    return this.#port.close()
  }

  forget(): Promise<void> {
    return this.#port.forget()
  }

  addEventListener(type: "disconnect", listener: () => void): void {
    if (type === "disconnect") this.#disconnectListeners.add(listener)
  }

  removeEventListener(type: "disconnect", listener: () => void): void {
    if (type === "disconnect") this.#disconnectListeners.delete(listener)
  }
}

export function createBrowserAdapter(
  serial: Serial = navigator.serial
): SerialAdapter {
  return {
    async getPorts() {
      const ports = await serial.getPorts()
      return ports.map((port) => new BrowserSerialPort(port))
    },
    async requestPort(options?: RequestPortOptions) {
      const port = await serial.requestPort({
        // Web Serial requires a vendor ID in chooser filters. Product-only
        // filters still work for already-granted ports through getPorts().
        filters: (options?.filters ?? []).flatMap((filter) => {
          if (filter.usbVendorId === undefined) return []
          return [
            {
              usbVendorId: filter.usbVendorId,
              usbProductId: filter.usbProductId,
            },
          ]
        }),
      })
      return new BrowserSerialPort(port)
    },
  }
}
