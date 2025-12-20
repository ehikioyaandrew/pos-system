import { invoke } from '@tauri-apps/api/core';

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
    const result = await invoke<UpdateInfo>('check_for_updates');
    return result;
  } catch (error) {
    console.error('Error checking for updates:', error);
    throw error;
  }
}

/**
 * Install the available update
 */
export async function installUpdate(): Promise<UpdateInstallResult> {
  try {
    const result = await invoke<UpdateInstallResult>('install_update');
    return result;
  } catch (error) {
    console.error('Error installing update:', error);
    throw error;
  }
}



