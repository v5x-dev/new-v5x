// Diagnostic runs only. Official budget checks leave WebAssembly untouched.
// Weak references avoid keeping completed command heaps alive during profiling.
export const workerMemoryDiagnostics = String.raw`
(() => {
  const NativeMemory = WebAssembly.Memory;
  const NativeInstance = WebAssembly.Instance;
  const memories = new WeakSet();
  let references = [];
  let peakBytes = 0;
  let discovered = 0;
  let largestMemoryBytes = 0;
  let lastReport = 0;

  const measure = () => {
    let bytes = 0;
    references = references.filter(reference => {
      const memory = reference.deref();
      if (!memory) return false;
      bytes += memory.buffer.byteLength;
      largestMemoryBytes = Math.max(largestMemoryBytes, memory.buffer.byteLength);
      return true;
    });
    peakBytes = Math.max(peakBytes, bytes);
    if (performance.now() - lastReport > 100) {
      lastReport = performance.now();
      self.postMessage({kind: 'worker-memory-diagnostic', bytes, peakBytes,
        discovered, largestMemoryBytes, live: references.length});
    }
  };
  const remember = memory => {
    if (!(memory instanceof NativeMemory) || memories.has(memory)) return;
    memories.add(memory);
    references.push(new WeakRef(memory));
    discovered++;
    largestMemoryBytes = Math.max(largestMemoryBytes, memory.buffer.byteLength);
  };
  const inspect = instance => {
    for (const value of Object.values(instance.exports)) remember(value);
    return instance;
  };
  WebAssembly.Memory = new Proxy(NativeMemory, {construct(target, args, newTarget) {
    const memory = Reflect.construct(target, args, newTarget);
    remember(memory);
    return memory;
  }});
  for (const name of ['instantiate', 'instantiateStreaming']) {
    const native = WebAssembly[name]?.bind(WebAssembly);
    if (!native) continue;
    WebAssembly[name] = async (...args) => {
      const result = await native(...args);
      return result instanceof NativeInstance ? inspect(result) :
        {...result, instance: inspect(result.instance)};
    };
  }
  setInterval(measure, 100);
})();
`
