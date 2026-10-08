let active = false
const listeners = new Set<(active: boolean) => void>()

export function setBrowserBuildActive(value: boolean) {
  active = value
  for (const listener of listeners) listener(value)
}

export function observeBrowserBuild(listener: (active: boolean) => void) {
  listeners.add(listener)
  listener(active)
  return () => listeners.delete(listener)
}
