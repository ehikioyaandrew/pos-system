/** Web build stubs — no Tauri updater. */
export interface UpdateInfo {
  available: boolean
  version?: string
  date?: string
  body?: string
  current_version: string
}

export interface UpdateInstallResult {
  success: boolean
  message: string
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  return {
    available: false,
    current_version: import.meta.env.VITE_APP_VERSION || '1.0.0-web',
  }
}

export async function installUpdate(): Promise<UpdateInstallResult> {
  return {
    success: false,
    message: 'Updates are not available in the web version.',
  }
}
