import { AckType, type IPacketCallback } from "../vex"
import { VexEventTarget } from "../vex-event"
import { PendingRequestDispatcher } from "../pending-request-dispatcher"
import { ReceiveBuffer } from "../receive-buffer"
import { runPacketReader } from "../packet-reader"
import { TailQueue } from "../tail-queue"
import {
  DeviceBoundPacket,
  type HostBoundPacket,
  Query1H2DPacket,
  Query1ReplyD2HPacket,
  SystemVersionH2DPacket,
  SystemVersionReplyD2HPacket,
} from "../vex-packet"
import { VexFirmwareVersion } from "../vex-firmware-version"
import type {
  AdapterSerialPort,
  SerialAdapter,
  SerialPortFilter,
} from "../../adapters/serial-adapter"
import { portMatchesFilters } from "../../adapters/serial-adapter"

export const DEFAULT_MAX_FILE_DOWNLOAD_BYTES = 64 * 1024 * 1024

export const DEFAULT_TRANSFER_WINDOW_SIZE = 4

export const DEFAULT_USER_FIFO_TIMEOUT = 500

export interface VexSerialConnectionOptions {
  maxFileDownloadBytes?: number
  /**
   * Retained for compatibility with the previous transport implementation.
   * CDC2 write replies have no sequence number, so file uploads stay
   * stop-and-wait and do not send multiple writes at once.
   */
  transferWindowSize?: number
}

export interface VexSerialConnectionEvents {
  connected: undefined
  disconnected: undefined
  warning: { message: string; details?: unknown }
}

type HostBoundPacketConstructor<T extends HostBoundPacket> = {
  new (data: Uint8Array | ArrayBuffer): T
}

/**
 * A connection to a V5 device.
 * Emit events: connected, disconnected
 */
export class VexSerialConnection extends VexEventTarget<VexSerialConnectionEvents> {
  filters: SerialPortFilter[] = [{ usbVendorId: 10376 }]

  writer: WritableStreamDefaultWriter<Uint8Array> | undefined
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  port: AdapterSerialPort | undefined
  serial: SerialAdapter
  #closing = false
  #closePromise: Promise<void> | undefined
  #openPromise: Promise<boolean | undefined> | undefined
  #portDisconnectListener: (() => void) | undefined
  #wasConnected = false
  readonly maxFileDownloadBytes: number
  readonly transferWindowSize: number

  private readonly pendingRequests = new PendingRequestDispatcher()
  protected readonly fileTransfers = new TailQueue()

  /** A snapshot of outstanding requests, retained for compatibility. */
  get callbacksQueue(): IPacketCallback[] {
    return this.pendingRequests.callbacks
  }

  get isConnected(): boolean {
    return (
      this.port !== undefined &&
      this.reader !== undefined &&
      this.writer !== undefined
    )
  }

  get isClosing(): boolean {
    return this.#closing
  }

  constructor(serial: SerialAdapter, options: VexSerialConnectionOptions = {}) {
    super()
    this.serial = serial

    const maxFileDownloadBytes =
      options.maxFileDownloadBytes ?? DEFAULT_MAX_FILE_DOWNLOAD_BYTES

    if (
      !Number.isSafeInteger(maxFileDownloadBytes) ||
      maxFileDownloadBytes <= 0
    ) {
      throw new RangeError(
        "maxFileDownloadBytes must be a positive safe integer"
      )
    }

    this.maxFileDownloadBytes = maxFileDownloadBytes

    const transferWindowSize =
      options.transferWindowSize ?? DEFAULT_TRANSFER_WINDOW_SIZE

    if (!Number.isSafeInteger(transferWindowSize) || transferWindowSize <= 0) {
      throw new RangeError("transferWindowSize must be a positive safe integer")
    }

    this.transferWindowSize = transferWindowSize
  }

  async close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise
    this.#closing = true

    const closing = this.closeResources()
    this.#closePromise = closing

    try {
      await closing
    } finally {
      if (this.#closePromise === closing) this.#closePromise = undefined
      this.#closing = false
    }
  }

  private async closeResources(): Promise<void> {
    for (const callback of this.pendingRequests.drain()) {
      callback.callback(AckType.NOT_CONNECTED)
    }

    const disconnectListener = this.#portDisconnectListener
    this.#portDisconnectListener = undefined

    if (disconnectListener !== undefined) {
      try {
        this.port?.removeEventListener?.("disconnect", disconnectListener)
      } catch {}
    }

    const writer = this.writer
    this.writer = undefined

    if (writer !== undefined) {
      try {
        await writer.close()
      } catch {}

      try {
        writer.releaseLock()
      } catch {}
    }

    const reader = this.reader
    this.reader = undefined

    if (reader !== undefined) {
      try {
        await reader.cancel()
      } catch {}

      try {
        reader.releaseLock()
      } catch {}
    }

    const port = this.port
    this.port = undefined

    if (port !== undefined) {
      try {
        await port.close()
      } catch (error) {
        this.emitWarning("failed to close the serial port", error)
      }
    }

    if (this.#wasConnected) {
      this.#wasConnected = false
      this.emitSafely("disconnected", undefined)
    }
  }

  async open(
    use: number | undefined = 0,
    askUser: boolean = true
  ): Promise<boolean | undefined> {
    if (this.#openPromise !== undefined) return this.#openPromise

    const opening = this.openPort(use, askUser)
    this.#openPromise = opening

    void opening.then(
      () => {
        if (this.#openPromise === opening) this.#openPromise = undefined
      },
      () => {
        if (this.#openPromise === opening) this.#openPromise = undefined
      }
    )

    return opening
  }

  private async openPort(
    use: number | undefined,
    askUser: boolean
  ): Promise<boolean | undefined> {
    if (this.#closePromise !== undefined) await this.#closePromise
    if (this.port !== undefined) throw new Error("Already connected.")

    let port: AdapterSerialPort | undefined

    if (use !== undefined) {
      let matchingPorts: AdapterSerialPort[]

      try {
        matchingPorts = (await this.serial.getPorts()).filter((candidate) =>
          portMatchesFilters(candidate.getInfo(), this.filters)
        )
      } catch {
        return false
      }

      const ports = matchingPorts.filter(
        (candidate) => candidate.readable === null
      )

      port = ports[use]
      if (port == null && matchingPorts[use] != null) return false
    }

    // A missing indexed port means the caller has already tried every granted
    // port. Do not open the chooser again for each retry.
    if (port == null && askUser && (use === undefined || use === 0)) {
      try {
        port = await this.serial.requestPort({ filters: this.filters })
      } catch {}
    }

    if (port == null) return undefined

    if (port.readable != null) return false

    try {
      await port.open({ baudRate: 115200 })

      this.port = port

      this.#portDisconnectListener = () => {
        void this.close()
      }

      port.addEventListener("disconnect", this.#portDisconnectListener)

      const writable = port.writable as WritableStream<Uint8Array> | null
      const readable = port.readable as ReadableStream<Uint8Array> | null

      if (writable == null || readable == null) {
        await this.close()
        return false
      }

      this.writer = writable.getWriter()
      this.reader = readable.getReader()
      this.#wasConnected = true
      void this.startReader()
      this.emitSafely("connected", undefined)

      return true
    } catch {
      await this.close()
      return false
    }
  }

  writeData(
    rawData: DeviceBoundPacket | Uint8Array,
    resolve: (
      data: HostBoundPacket | ArrayBuffer | Uint8Array | AckType
    ) => void,
    timeout: number = 1000
  ): void {
    void this.writeDataAsync(rawData, timeout).then(resolve)
  }

  async writeDataAsync(
    rawData: DeviceBoundPacket | Uint8Array,
    timeout: number = 1000,
    pipelined = false
  ): Promise<HostBoundPacket | ArrayBuffer | Uint8Array | AckType> {
    if (!Number.isFinite(timeout) || timeout < 0 || timeout > 0x7fffffff) {
      throw new RangeError("timeout must be between 0 and 2147483647 ms")
    }

    if (rawData instanceof DeviceBoundPacket && !pipelined) {
      return this.pendingRequests.serialize(
        rawData.commandId,
        rawData.commandExtendedId,
        () => this.writeDataAsyncUnserialized(rawData, timeout)
      )
    }

    return this.writeDataAsyncUnserialized(rawData, timeout)
  }

  private async writeDataAsyncUnserialized(
    rawData: DeviceBoundPacket | Uint8Array,
    timeout: number
  ): Promise<HostBoundPacket | ArrayBuffer | Uint8Array | AckType> {
    return new Promise((resolve) => {
      const writer = this.writer

      if (writer === undefined || this.#closing) {
        resolve(AckType.NOT_CONNECTED)
        return
      }

      const data = rawData instanceof DeviceBoundPacket ? rawData.data : rawData
      let removePending = (): boolean => false

      const callback: IPacketCallback = {
        callback: resolve,
        timeout: setTimeout(() => {
          if (!removePending()) return
          resolve(AckType.TIMEOUT)
        }, timeout),
        wantedCommandId:
          rawData instanceof DeviceBoundPacket ? rawData.commandId : undefined,
        wantedCommandExId:
          rawData instanceof DeviceBoundPacket
            ? rawData.commandExtendedId
            : undefined,
      }

      removePending = this.pendingRequests.add(callback)

      try {
        void writer.write(data).catch(() => {
          if (!removePending()) return
          clearTimeout(callback.timeout)
          resolve(AckType.WRITE_ERROR)
        })
      } catch {
        if (removePending()) {
          clearTimeout(callback.timeout)
          resolve(AckType.WRITE_ERROR)
        }
      }
    })
  }

  protected async readData(
    cache: ReceiveBuffer,
    expectedSize: number
  ): Promise<void> {
    if (this.reader == null) throw new Error("No reader")

    while (cache.byteLength < expectedSize) {
      const { value: readData, done: isDone } = await this.reader.read()

      if (isDone || readData === undefined) throw new Error("No data")

      if (readData.byteLength === 0) continue
      cache.append(readData)
    }
  }

  protected async startReader(): Promise<void> {
    await runPacketReader({
      readData: (cache, expectedSize) => this.readData(cache, expectedSize),
      shiftCallback: (commandId, commandExtendedId) =>
        this.pendingRequests.shift(commandId, commandExtendedId),
      reportWarning: (message, details) => {
        if (!this.#closing) this.emitWarning(message, details)
      },
      close: () => this.close(),
    })
  }

  protected emitWarning(message: string, details?: unknown): void {
    this.emitSafely("warning", { message, details })
  }

  async request<T extends HostBoundPacket>(
    packet: DeviceBoundPacket,
    replyType: HostBoundPacketConstructor<T>,
    timeout = 1000
  ): Promise<T | null> {
    const result = await this.writeDataAsync(packet, timeout)
    return result instanceof replyType ? result : null
  }

  private emitSafely<K extends keyof VexSerialConnectionEvents>(
    eventName: K,
    data: VexSerialConnectionEvents[K]
  ): void {
    try {
      this.emit(eventName, data)
    } catch {}
  }

  async query1(): Promise<Query1ReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new Query1H2DPacket(), 1000)
    return result instanceof Query1ReplyD2HPacket ? result : null
  }

  async getSystemVersion(): Promise<VexFirmwareVersion | null> {
    const result = await this.writeDataAsync(new SystemVersionH2DPacket())
    return result instanceof SystemVersionReplyD2HPacket ? result.version : null
  }
}
