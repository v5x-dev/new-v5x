export function createByteStreams(handlers: {
  write: (data: Uint8Array) => Promise<void>;
  subscribe: (
    onData: (data: Uint8Array) => void,
    onError: (err: unknown) => void,
    onClose: () => void,
  ) => () => void;
}): {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
} {
  let unsubscribe: (() => void) | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = handlers.subscribe(
        (data) => controller.enqueue(data),
        (err) => controller.error(err),
        () => {
          try {
            controller.close();
          } catch {}
        },
      );
    },
    cancel() {
      unsubscribe?.();
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      return handlers.write(chunk);
    },
  });
  return { readable, writable };
}
