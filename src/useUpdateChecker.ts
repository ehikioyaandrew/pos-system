import { useState, useEffect, useCallback } from 'react';
import { checkForUpdates, installUpdate, UpdateInfo } from './updateApi';

interface UseUpdateCheckerReturn {
  updateInfo: UpdateInfo | null;
  isChecking: boolean;
  isInstalling: boolean;
  checkUpdates: () => Promise<void>;
  install: () => Promise<void>;
}

export function useUpdateChecker(
  autoCheck: boolean = true,
  checkInterval: number = 3600000 // 1 hour default
): UseUpdateCheckerReturn {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  const checkUpdates = useCallback(async () => {
    setIsChecking(true);
    try {
      const info = await checkForUpdates();
      setUpdateInfo(info);
    } catch (error) {
      console.error('Failed to check for updates:', error);
    } finally {
      setIsChecking(false);
    }
  }, []);

  const install = useCallback(async () => {
    if (!updateInfo?.available) return;
    
    setIsInstalling(true);
    try {
      const result = await installUpdate();
      if (result.success) {
        // The app will restart automatically
      } else {
        console.error('Update installation failed:', result.message);
      }
    } catch (error) {
      console.error('Failed to install update:', error);
    } finally {
      setIsInstalling(false);
    }
  }, [updateInfo]);

  // Auto-check on mount if enabled
  useEffect(() => {
    if (autoCheck) {
      checkUpdates();
    }
  }, [autoCheck, checkUpdates]);

  // Set up periodic checking
  useEffect(() => {
    if (!autoCheck) return;

    const interval = setInterval(() => {
      checkUpdates();
    }, checkInterval);

    return () => clearInterval(interval);
  }, [autoCheck, checkInterval, checkUpdates]);

  return {
    updateInfo,
    isChecking,
    isInstalling,
    checkUpdates,
    install
  };
}


