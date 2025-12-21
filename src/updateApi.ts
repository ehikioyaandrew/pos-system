import { check } from '@tauri-apps/plugin-updater';
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';

export interface UpdateInfo {
  available: boolean;
  version?: string;
  date?: string;
  body?: string;
  current_version: string;
}

export interface UpdateInstallResult {
  success: boolean;
  message: string;
}

/**
 * Check for available updates
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  try {
    const currentVersion = await getVersion();
    const update = await check();
    
    if (update) {
      return {
        available: true,
        version: update.version,
        date: update.date,
        body: update.body,
        current_version: currentVersion
      };
    } else {
      return {
        available: false,
        current_version: currentVersion
      };
    }
  } catch (error) {
    console.error('Error checking for updates:', error);
    const currentVersion = await getVersion().catch(() => 'unknown');
    return {
      available: false,
      current_version: currentVersion
    };
  }
}

/**
 * Install the available update
 */
export async function installUpdate(): Promise<UpdateInstallResult> {
  try {
    const update = await check();
    
    if (!update) {
      return {
        success: false,
        message: 'No update available'
      };
    }

    await update.downloadAndInstall((event) => {
      if (event.event === 'Progress') {
        console.log(`Downloaded ${event.data.chunkLength} bytes`);
      } else if (event.event === 'Finished') {
        console.log('Download finished, installing...');
      } else if (event.event === 'Started') {
        console.log('Download started...');
      }
    });

    // Restart the app after installation
    await relaunch();
    
    return {
      success: true,
      message: 'Update installed successfully. The application will restart.'
    };
  } catch (error: any) {
    console.error('Error installing update:', error);
    return {
      success: false,
      message: error?.message || 'Failed to install update'
    };
  }
}



