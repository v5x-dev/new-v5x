import type { SavedWorkspace } from './persistence'

export type DraftStatus = 'saving' | 'saved' | 'error'

// Serial writes prevent an older, slower snapshot overwriting newer edits.
export class DraftWriter {
  private pending: SavedWorkspace | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private writes: Promise<void> = Promise.resolve()
  private revision = 0

  constructor(
    private write: (snapshot: SavedWorkspace) => Promise<void>,
    private status: (status: DraftStatus, error?: string) => void,
    private delay = 250,
  ) {}

  schedule(snapshot: SavedWorkspace) {
    this.pending = snapshot
    this.revision++
    this.status('saving')
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), this.delay)
  }

  flush(): Promise<void> {
    clearTimeout(this.timer)
    const snapshot = this.pending
    if (!snapshot) return this.writes
    this.pending = undefined
    const revision = this.revision
    this.writes = this.writes.then(async () => {
      try {
        await this.write(snapshot)
        if (revision === this.revision) this.status('saved')
      } catch (error) {
        if (revision === this.revision) {
          this.pending = snapshot
          this.status(
            'error',
            error instanceof Error
              ? error.message
              : 'Draft storage is unavailable',
          )
        }
      }
    })
    return this.writes
  }
}
