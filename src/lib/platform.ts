/** Detect whether the UI is running inside the Tauri desktop shell. */
export function isTauriApp(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(
    (window as any).__TAURI_INTERNALS__ ||
      (window as any).__TAURI__ ||
      (window as any).isTauri
  )
}

export function runtimeLabel(): 'Desktop' | 'Web' {
  return isTauriApp() ? 'Desktop' : 'Web'
}
