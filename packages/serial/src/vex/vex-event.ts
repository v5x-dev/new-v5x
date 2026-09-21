type EventName = string | symbol;
type EventKey<TEvents> = Extract<keyof TEvents, EventName>;
type EventListener<TValue> = (data: TValue) => void;

/** A small typed event emitter used by connections, devices, and terminals. */
export class VexEventEmitter<
  TEvents extends object = Record<EventName, unknown>,
> {
  private readonly handlerMap = new Map<
    EventName,
    Array<EventListener<unknown>>
  >();

  on<K extends EventKey<TEvents>>(
    eventName: K,
    listener: EventListener<TEvents[K]>,
  ): void {
    const listeners = this.handlerMap.get(eventName) ?? [];
    listeners.push(listener as EventListener<unknown>);
    this.handlerMap.set(eventName, listeners);
  }

  remove<K extends EventKey<TEvents>>(
    eventName: K,
    listener: EventListener<TEvents[K]>,
  ): void {
    const listeners = this.handlerMap.get(eventName);
    if (listeners === undefined) return;

    const index = listeners.indexOf(listener as EventListener<unknown>);
    if (index === -1) return;
    listeners.splice(index, 1);
    if (listeners.length === 0) this.handlerMap.delete(eventName);
  }

  emit<K extends EventKey<TEvents>>(eventName: K, data: TEvents[K]): void {
    const listeners = this.handlerMap.get(eventName);
    if (listeners === undefined || listeners.length === 0) return;

    const errors: unknown[] = [];
    for (const listener of [...listeners]) {
      try {
        listener(data);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      const aggregate = new Error(
        `listeners for ${String(eventName)} failed`,
      ) as Error & { errors: unknown[] };
      aggregate.name = "AggregateError";
      aggregate.errors = errors;
      throw aggregate;
    }
  }

  clearListeners(): void {
    this.handlerMap.clear();
  }
}

export class VexEventTarget<
  TEvents extends object = Record<EventName, unknown>,
> {
  readonly emitter: VexEventEmitter<TEvents>;

  constructor() {
    this.emitter = new VexEventEmitter<TEvents>();
  }

  emit<K extends EventKey<TEvents>>(eventName: K, data: TEvents[K]): void {
    this.emitter.emit(eventName, data);
  }

  on<K extends EventKey<TEvents>>(
    eventName: K,
    listener: EventListener<TEvents[K]>,
  ): void {
    this.emitter.on(eventName, listener);
  }

  remove<K extends EventKey<TEvents>>(
    eventName: K,
    listener: EventListener<TEvents[K]>,
  ): void {
    this.emitter.remove(eventName, listener);
  }

  clearListeners(): void {
    this.emitter.clearListeners();
  }
}
