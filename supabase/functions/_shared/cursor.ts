export function encodeCursor(value: Record<string, unknown>) {
  return btoa(JSON.stringify(value))
}

export function decodeCursor<T>(value: string | null): T | null {
  if (!value) return null
  try {
    const json = atob(value)
    return JSON.parse(json) as T
  } catch {
    return null
  }
}
