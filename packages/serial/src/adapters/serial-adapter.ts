export type SerialPortFilter = {
  usbVendorId?: number;
  usbProductId?: number;
};

export type SerialPortInfo = {
  usbVendorId?: number;
  usbProductId?: number;
  path?: string;
};

export type RequestPortOptions = {
  filters?: SerialPortFilter[];
  path?: string;
};

export interface AdapterSerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  addEventListener(type: "disconnect", listener: () => void): void;
  removeEventListener?: (type: "disconnect", listener: () => void) => void;
}

export interface SerialAdapter {
  getPorts(): Promise<AdapterSerialPort[]>;
  requestPort(options?: RequestPortOptions): Promise<AdapterSerialPort>;
}

export function portMatchesFilters(
  info: SerialPortInfo,
  filters?: SerialPortFilter[],
): boolean {
  if (filters === undefined || filters.length === 0) return true;
  return filters.some(
    (filter) =>
      (filter.usbVendorId === undefined ||
        filter.usbVendorId === info.usbVendorId) &&
      (filter.usbProductId === undefined ||
        filter.usbProductId === info.usbProductId),
  );
}

export function parseUsbId(
  value: string | number | undefined,
): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value === "number") return value;
  const parsed = Number.parseInt(value, 16);
  return Number.isNaN(parsed) ? undefined : parsed;
}
