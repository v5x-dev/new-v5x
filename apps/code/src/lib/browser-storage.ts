// localStorage throws when storage is disabled. Callers fall back to
// session-only state, so failures are ignored here.

export function readStorage(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* Keep the value for this session. */
  }
}
