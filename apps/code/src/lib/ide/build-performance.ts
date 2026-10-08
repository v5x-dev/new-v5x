export interface BuildTimingEvent {
  clock?: 'worker' | 'client'
  buildId: string
  phase: string
  start: number
  end: number
  outcome: 'success' | 'error' | 'cancelled'
  counts?: Record<string, number>
}

/** Opt-in spans use one monotonic clock per execution context. Never sum overlaps. */
export function buildTimings(
  buildId: string,
  report?: (event: BuildTimingEvent) => void,
) {
  return {
    async measure<T>(
      phase: string,
      work: () => Promise<T>,
      counts?: Record<string, number>,
    ): Promise<T> {
      if (!report) return work()
      const start = performance.now()
      try {
        const result = await work()
        report({
          buildId,
          clock: 'worker',
          counts,
          phase,
          start,
          end: performance.now(),
          outcome: 'success',
        })
        return result
      } catch (error) {
        report({
          buildId,
          clock: 'worker',
          counts,
          phase,
          start,
          end: performance.now(),
          outcome: 'error',
        })
        throw error
      }
    },
  }
}
