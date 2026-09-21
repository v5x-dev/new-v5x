declare module "bun-serialport" {
  import { EventEmitter } from "node:events";

  export type BunSerialPortInfo = {
    path: string;
    manufacturer?: string;
    serialNumber?: string;
    vendorId?: string;
    productId?: string;
    product?: string;
    pnpId?: string;
    locationId?: string;
  };

  export type BunSerialPortOptions = {
    path: string;
    baudRate: number;
    autoOpen?: boolean;
  };

  export class SerialPort extends EventEmitter {
    constructor(options: BunSerialPortOptions);
    readonly path: string;
    readonly baudRate: number;
    readonly isOpen: boolean;
    open(): Promise<void>;
    close(): Promise<void>;
    write(
      data: Uint8Array | ArrayBuffer | number[] | string,
    ): Promise<number | void>;
    on(event: "data", listener: (chunk: Uint8Array) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(
      event: "close",
      listener: (err?: Error & { disconnected?: boolean }) => void,
    ): this;
    off(event: "data", listener: (chunk: Uint8Array) => void): this;
    off(event: "error", listener: (err: Error) => void): this;
    off(
      event: "close",
      listener: (err?: Error & { disconnected?: boolean }) => void,
    ): this;
  }

  export function list(): Promise<BunSerialPortInfo[]>;
}
