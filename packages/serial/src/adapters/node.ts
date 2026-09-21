import { SerialPort } from "serialport";
import { createByteStreams } from "./byte-streams";
import {
  type AdapterSerialPort,
  parseUsbId,
  portMatchesFilters,
  type RequestPortOptions,
  type SerialAdapter,
  type SerialPortInfo,
} from "./serial-adapter";

export type NodeAdapterOptions = {
  path?: string;
};

class NodeSerialPort implements AdapterSerialPort {
  #info: SerialPortInfo;
  #port: SerialPort | undefined;
  #readable: ReadableStream<Uint8Array> | null = null;
  #writable: WritableStream<Uint8Array> | null = null;
  #onDisconnect?: () => void;

  constructor(info: SerialPortInfo) {
    this.#info = info;
  }

  get readable(): ReadableStream<Uint8Array> | null {
    return this.#readable;
  }

  get writable(): WritableStream<Uint8Array> | null {
    return this.#writable;
  }

  getInfo(): SerialPortInfo {
    return this.#info;
  }

  async open(options: { baudRate: number }): Promise<void> {
    if (this.#info.path === undefined) {
      throw new Error("Serial port path is missing.");
    }
    const port = new SerialPort({
      path: this.#info.path,
      baudRate: options.baudRate,
      autoOpen: false,
    });
    await new Promise<void>((resolve, reject) => {
      port.open((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    this.#port = port;

    const streams = createByteStreams({
      write: (data) =>
        new Promise((resolve, reject) => {
          port.write(Buffer.from(data), (err) => {
            if (err) reject(err);
            else resolve();
          });
        }),
      subscribe: (onData, onError, onClose) => {
        const data = (chunk: Buffer) => onData(new Uint8Array(chunk));
        const error = (err: Error) => onError(err);
        const close = () => {
          this.#onDisconnect?.();
          onClose();
        };
        port.on("data", data);
        port.on("error", error);
        port.on("close", close);
        return () => {
          port.off("data", data);
          port.off("error", error);
          port.off("close", close);
        };
      },
    });

    this.#readable = streams.readable;
    this.#writable = streams.writable;
  }

  async close(): Promise<void> {
    if (this.#port?.isOpen) {
      await new Promise<void>((resolve, reject) => {
        this.#port?.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    this.#port = undefined;
    this.#readable = null;
    this.#writable = null;
  }

  addEventListener(type: "disconnect", listener: () => void): void {
    if (type === "disconnect") this.#onDisconnect = listener;
  }

  removeEventListener(type: "disconnect", listener: () => void): void {
    if (type === "disconnect" && this.#onDisconnect === listener) {
      this.#onDisconnect = undefined;
    }
  }
}

export function createNodeAdapter(
  options: NodeAdapterOptions = {},
): SerialAdapter {
  const listed = async (): Promise<NodeSerialPort[]> => {
    const ports = await SerialPort.list();
    return ports
      .filter((port) => options.path === undefined || port.path === options.path)
      .map(
        (port) =>
          new NodeSerialPort({
            path: port.path,
            usbVendorId: parseUsbId(port.vendorId),
            usbProductId: parseUsbId(port.productId),
          }),
      );
  };

  return {
    getPorts: listed,
    async requestPort(request?: RequestPortOptions) {
      const ports = await listed();
      const path = request?.path ?? options.path;
      const match = ports.find((port) => {
        const info = port.getInfo();
        if (path !== undefined && info.path !== path) return false;
        return portMatchesFilters(info, request?.filters);
      });
      if (match === undefined) {
        throw new Error("No serial port matched the request.");
      }
      return match;
    },
  };
}
