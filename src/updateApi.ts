import { isTauriApp } from './lib/platform'

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

/** Pending update object from @tauri-apps/plugin-updater (module-scoped). */
let pendingUpdate: any = null

async function currentAppVersion(): Promise<string> {
  if (isTauriApp()) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      return await getVersion()
    } catch {
      /* fall through */
    }
  }
  return import.meta.env.VITE_APP_VERSION || '1.0.0'
}

/**
 * Check GitHub Releases (or configured endpoints) for a newer signed build.
 * Web builds never have updates.
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  const current_version = await currentAppVersion()
  if (!isTauriApp()) {
    return { available: false, current_version }
  }

  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    pendingUpdate = update
    if (!update) {
      return { available: false, current_version }
    }
    return {
      available: true,
      version: update.version,
      date: update.date,
      body: update.body,
      current_version,
    }
  } catch (e) {
    pendingUpdate = null
    const msg = e instanceof Error ? e.message : String(e)
    const lower = msg.toLowerCase()
    // Private GitHub repo / missing latest.json / no network → friendly message
    if (
      lower.includes('release json') ||
      lower.includes('latest.json') ||
      lower.includes('404') ||
      lower.includes('not found') ||
      lower.includes('failed to fetch') ||
      lower.includes('network') ||
      lower.includes('dns')
    ) {
      throw new Error(
        'Could not reach the update feed. The till still works — install a new setup.exe from your admin when one is ready, or try again when online.'
      )
    }
    if (lower.includes('pubkey') || lower.includes('endpoint') || lower.includes('signature')) {
      throw new Error(
        'Updater is not fully configured yet. Ask your admin to publish a signed release.'
      )
    }
    throw new Error(msg || 'Could not check for updates')
  }
}

/** Download, install, and relaunch with the pending update. */
export async function installUpdate(): Promise<UpdateInstallResult> {
  if (!isTauriApp()) {
    return {
      success: false,
      message: 'Updates are not available in the web version.',
    }
  }

  try {
    if (!pendingUpdate) {
      const { check } = await import('@tauri-apps/plugin-updater')
      pendingUpdate = await check()
    }
    if (!pendingUpdate) {
      return { success: false, message: 'No update available.' }
    }

    await pendingUpdate.downloadAndInstall()
    pendingUpdate = null

    try {
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch {
      // Windows often exits/restarts via the installer; relaunch is best-effort
    }

    return {
      success: true,
      message: 'Update installed. The app will restart.',
    }
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? e.message : 'Failed to install update',
    }
  }
}
