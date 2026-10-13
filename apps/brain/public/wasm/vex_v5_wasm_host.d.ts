/* tslint:disable */
/* eslint-disable */
/**
 * The browser host uses exactly the same bincode packets and renderer as the
 * native host.
 */
export class BrowserHost {
  free(): void;
  constructor();
  push(bytes: Uint8Array): any;
  take_frame(): Uint8Array | undefined;
  distance(port: number, distance: number, size: number, visible: boolean, timestamp: number): Uint8Array;
  disconnect(port: number, timestamp: number): Uint8Array;
  motor(port: number): Uint8Array;
  controller(id: number, axis1: number, axis2: number, axis3: number, axis4: number, buttons: number, capacity: number, connected: boolean): Uint8Array;
  battery(capacity: number, voltage: number, current: number, temperature: number): Uint8Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_browserhost_free: (a: number, b: number) => void;
  readonly browserhost_new: () => number;
  readonly browserhost_push: (a: number, b: number, c: number) => [number, number, number];
  readonly browserhost_take_frame: (a: number) => [number, number];
  readonly browserhost_distance: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
  readonly browserhost_disconnect: (a: number, b: number, c: number) => [number, number, number, number];
  readonly browserhost_motor: (a: number, b: number) => [number, number, number, number];
  readonly browserhost_controller: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number, number];
  readonly browserhost_battery: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
  readonly __wbindgen_export_0: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
