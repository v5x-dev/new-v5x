// All editor instances in this page share a queue for each workspace. A remount
// must read the final write from the departing instance before recovering drafts.
const queues = new Map<string, Promise<unknown>>()

export function workspaceIO<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const result = previous.catch(() => {}).then(operation)
  queues.set(key, result)
  void result
    .finally(() => {
      if (queues.get(key) === result) queues.delete(key)
    })
    .catch(() => {})
  return result
}
