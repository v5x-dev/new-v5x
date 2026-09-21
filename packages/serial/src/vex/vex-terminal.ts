import { UserFifoChannel } from "./vex";
import { V5SerialConnection } from "./vex-connection";
import { VexEventTarget } from "./vex-event";

export const DEFAULT_TERMINAL_IDLE_POLL_MS = 50;
export const DEFAULT_TERMINAL_MAX_CONSECUTIVE_ERRORS = 20;

export interface V5TerminalOptions {
  idlePollIntervalMs?: number;
  timeoutMs?: number;
  maxConsecutiveErrors?: number;
}

export interface V5TerminalEvents {
  data: Uint8Array;
  text: string;
  error: Error;
  closed: undefined;
}

/** Poll the user program's stdout FIFO and write its stdin FIFO. */
export class V5UserProgramTerminal extends VexEventTarget<V5TerminalEvents> {
  readonly idlePollIntervalMs: number;
  readonly timeoutMs: number;
  readonly maxConsecutiveErrors: number;

  private readonly connection: V5SerialConnection;
  private readonly decoder = new TextDecoder();
  private running = false;
  private polling: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private wakeIdleWait: (() => void) | undefined;
  private emittedClosed = false;

  constructor(
    connection: V5SerialConnection,
    options: V5TerminalOptions = {},
  ) {
    super();
    const idlePollIntervalMs =
      options.idlePollIntervalMs ?? DEFAULT_TERMINAL_IDLE_POLL_MS;
    const timeoutMs = options.timeoutMs ?? 500;
    const maxConsecutiveErrors =
      options.maxConsecutiveErrors ?? DEFAULT_TERMINAL_MAX_CONSECUTIVE_ERRORS;

    if (!Number.isFinite(idlePollIntervalMs) || idlePollIntervalMs < 0) {
      throw new RangeError("idlePollIntervalMs must be non-negative");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 0x7fffffff) {
      throw new RangeError("timeoutMs must be between 0 and 2147483647 ms");
    }
    if (!Number.isSafeInteger(maxConsecutiveErrors) || maxConsecutiveErrors < 1) {
      throw new RangeError("maxConsecutiveErrors must be a positive integer");
    }

    this.connection = connection;
    this.idlePollIntervalMs = idlePollIntervalMs;
    this.timeoutMs = timeoutMs;
    this.maxConsecutiveErrors = maxConsecutiveErrors;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running || this.closing !== undefined || this.emittedClosed) return;
    this.running = true;
    this.polling = this.poll();
  }

  async close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    if (!this.running && this.polling === undefined) return;

    this.running = false;
    this.wakeIdleWait?.();
    const polling = this.polling;
    const closing = (async () => {
      try {
        await polling;
      } finally {
        if (this.polling === polling) this.polling = undefined;
        this.closing = undefined;
      }
    })();
    this.closing = closing;
    await closing;
  }

  async write(data: Uint8Array | string): Promise<number | undefined> {
    return this.connection.writeUserFifo(
      data,
      UserFifoChannel.STDIN,
      this.timeoutMs,
    );
  }

  private async poll(): Promise<void> {
    let consecutiveErrors = 0;
    try {
      while (this.running) {
        if (!this.connection.isConnected) {
          this.emitSafely("error", new Error("Serial connection closed"));
          break;
        }

        const bytes = await this.connection.readUserFifo(
          UserFifoChannel.STDOUT,
          this.timeoutMs,
        );
        if (!this.running) break;

        if (bytes === undefined) {
          consecutiveErrors++;
          this.emitSafely("error", new Error("User FIFO read failed"));
          if (consecutiveErrors >= this.maxConsecutiveErrors) break;
          await this.waitIdle();
          continue;
        }

        consecutiveErrors = 0;
        if (bytes.byteLength === 0) {
          await this.waitIdle();
          continue;
        }

        this.emitSafely("data", bytes);
        this.emitSafely("text", this.decoder.decode(bytes, { stream: true }));
      }
    } finally {
      this.running = false;
      const trailingText = this.decoder.decode();
      if (trailingText !== "") this.emitSafely("text", trailingText);
      if (!this.emittedClosed) {
        this.emittedClosed = true;
        this.emitSafely("closed", undefined);
      }
    }
  }

  private waitIdle(): Promise<void> {
    // Promise.resolve() would keep an empty FIFO in a microtask loop and can
    // starve timers, UI work, and close(). Always yield to the event loop.
    if (this.idlePollIntervalMs === 0) {
      return new Promise((resolve) => setTimeout(resolve, 0));
    }
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
        if (this.wakeIdleWait === finish) this.wakeIdleWait = undefined;
        resolve();
      };
      timer = setTimeout(finish, this.idlePollIntervalMs);
      this.wakeIdleWait = finish;
    });
  }

  private emitSafely<K extends keyof V5TerminalEvents>(
    eventName: K,
    data: V5TerminalEvents[K],
  ): void {
    try {
      this.emit(eventName, data);
    } catch {}
  }
}

export function openUserProgramTerminal(
  connection: V5SerialConnection | undefined,
  options: V5TerminalOptions = {},
): V5UserProgramTerminal | undefined {
  if (connection === undefined || !connection.isConnected) return undefined;
  const terminal = new V5UserProgramTerminal(connection, options);
  terminal.start();
  return terminal;
}
