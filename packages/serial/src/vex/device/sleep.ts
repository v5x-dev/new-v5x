export async function sleepUntilAsync(
  f: () => Promise<boolean>,
  timeout: number,
  interval = 20
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeout)

  for (;;) {
    if (await f()) return true
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    await sleep(Math.min(Math.max(0, interval), remaining))
  }
}

export async function sleepUntil(
  f: () => boolean,
  timeout: number,
  interval = 20
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeout)

  for (;;) {
    if (f()) return true
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    await sleep(Math.min(Math.max(0, interval), remaining))
  }
}

export async function sleep(ms: number): Promise<unknown> {
  return await new Promise((resolve) => setTimeout(resolve, ms))
}
