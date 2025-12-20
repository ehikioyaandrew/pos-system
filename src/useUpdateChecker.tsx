import { useEffect, useState, useCallback } from 'react';
import { checkForUpdates, installUpdate, type UpdateInfo } from './updateApi';
import toast from 'react-hot-toast';

export function useUpdateChecker(autoCheck: boolean = true, checkInterval: number = 3600000) {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  const checkUpdates = useCallback(async () => {
    setIsChecking(true);
    try {
      const info = await checkForUpdates();
      setUpdateInfo(info);
      if (info.available) {
        toast.success(`Update available: Version ${info.version}`, {
          duration: 5000,
        });
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
      // Don't show error toast for update checks to avoid annoying users
    } finally {
      setIsChecking(false);
    }
  }, []);

  const install = useCallback(async () => {
    if (!updateInfo?.available) {
      toast.error('No update available to install');
      return;
    }

    setIsInstalling(true);
    try {
      const result = await installUpdate();
      if (result.success) {
        toast.success(result.message, {
          duration: 5000,
        });
      } else {
        toast.error(result.message || 'Failed to install update');
      }
    } catch (error: any) {
      console.error('Failed to install update:', error);
      toast.error(error?.message || 'Failed to install update');
    } finally {
      setIsInstalling(false);
    }
  }, [updateInfo]);

  useEffect(() => {
    if (autoCheck) {
      // Check immediately on mount
      checkUpdates();

      // Set up periodic checks
      const interval = setInterval(checkUpdates, checkInterval);
      return () => clearInterval(interval);
    }
  }, [autoCheck, checkInterval, checkUpdates]);

  return {
    updateInfo,
    isChecking,
    isInstalling,
    checkUpdates,
    install,
  };
}



