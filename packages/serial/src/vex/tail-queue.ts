/** Serialize asynchronous operations while allowing each operation to fail. */
export class TailQueue {
  private tail: Promise<void> = Promise.resolve()
  private depth = 0

  get isActive(): boolean {
    return this.depth > 0
  }

  async run<T>(operation: () => Promise<T> | T): Promise<T> {
    const previous = this.tail
    let release = (): void => {}
    const current = new Promise<void>((resolve) => {
      release = resolve
    })

    this.tail = previous.then(() => current)
    this.depth++
    try {
      await previous
      return await operation()
    } finally {
      this.depth--
      release()
    }
  }
}
