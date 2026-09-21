import type { IPacketCallback } from "./vex";
import { TailQueue } from "./tail-queue";

interface PendingCallback extends IPacketCallback {
  active: boolean;
  next?: PendingCallback;
  previous?: PendingCallback;
  queue: PendingQueue;
}

interface PendingQueue {
  head?: PendingCallback;
  tail?: PendingCallback;
}

/** Matches replies to requests and serializes identical commands. */
export class PendingRequestDispatcher {
  private readonly typed = new Map<string, PendingQueue>();
  private raw: PendingQueue = {};
  private readonly commandQueues = new Map<string, TailQueue>();

  get callbacks(): IPacketCallback[] {
    const result: IPacketCallback[] = [];
    for (const queue of this.typed.values()) this.copyQueue(queue, result);
    this.copyQueue(this.raw, result);
    return result;
  }

  get hasPending(): boolean {
    return this.typed.size > 0 || this.raw.head !== undefined;
  }

  async serialize<T>(
    commandId: number,
    commandExtendedId: number | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = this.key(commandId, commandExtendedId);
    let queue = this.commandQueues.get(key);
    if (queue === undefined) {
      queue = new TailQueue();
      this.commandQueues.set(key, queue);
    }

    try {
      return await queue.run(operation);
    } finally {
      if (!queue.isActive && this.commandQueues.get(key) === queue) {
        this.commandQueues.delete(key);
      }
    }
  }

  add(callback: IPacketCallback): () => boolean {
    const queue =
      callback.wantedCommandId === undefined
        ? this.raw
        : this.getQueue(
            callback.wantedCommandId,
            callback.wantedCommandExId,
            true,
          );
    const pending: PendingCallback = {
      ...callback,
      active: true,
      previous: queue.tail,
      queue,
    };

    if (queue.tail === undefined) queue.head = pending;
    else queue.tail.next = pending;
    queue.tail = pending;
    return () => this.remove(pending);
  }

  shift(
    commandId: number,
    commandExtendedId: number | undefined,
  ): IPacketCallback | undefined {
    const callback =
      this.getQueue(commandId, commandExtendedId, false)?.head ?? this.raw.head;
    if (callback !== undefined) this.remove(callback);
    return callback;
  }

  drain(): IPacketCallback[] {
    const result: IPacketCallback[] = [];
    for (const queue of this.typed.values()) this.drainQueue(queue, result);
    this.drainQueue(this.raw, result);
    this.typed.clear();
    this.raw = {};
    return result;
  }

  private copyQueue(queue: PendingQueue, result: IPacketCallback[]): void {
    for (let callback = queue.head; callback; callback = callback.next) {
      result.push(callback);
    }
  }

  private drainQueue(queue: PendingQueue, result: IPacketCallback[]): void {
    let callback = queue.head;
    while (callback !== undefined) {
      const next = callback.next;
      clearTimeout(callback.timeout);
      callback.active = false;
      callback.next = undefined;
      callback.previous = undefined;
      result.push(callback);
      callback = next;
    }
    queue.head = undefined;
    queue.tail = undefined;
  }

  private key(commandId: number, commandExtendedId: number | undefined): string {
    return `${commandId}:${commandExtendedId ?? ""}`;
  }

  private getQueue(
    commandId: number,
    commandExtendedId: number | undefined,
    create: true,
  ): PendingQueue;
  private getQueue(
    commandId: number,
    commandExtendedId: number | undefined,
    create: false,
  ): PendingQueue | undefined;
  private getQueue(
    commandId: number,
    commandExtendedId: number | undefined,
    create: boolean,
  ): PendingQueue | undefined {
    const key = this.key(commandId, commandExtendedId);
    let queue = this.typed.get(key);
    if (queue === undefined && create) {
      queue = {};
      this.typed.set(key, queue);
    }
    return queue;
  }

  private remove(callback: PendingCallback): boolean {
    if (!callback.active) return false;
    callback.active = false;

    const { queue, previous, next } = callback;
    if (previous === undefined) queue.head = next;
    else previous.next = next;
    if (next === undefined) queue.tail = previous;
    else next.previous = previous;
    callback.previous = undefined;
    callback.next = undefined;

    if (
      queue !== this.raw &&
      queue.head === undefined &&
      callback.wantedCommandId !== undefined
    ) {
      this.typed.delete(
        this.key(callback.wantedCommandId, callback.wantedCommandExId),
      );
    }
    return true;
  }
}
