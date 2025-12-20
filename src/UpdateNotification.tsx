import React from 'react';
import { useUpdateChecker } from './useUpdateChecker';
import toast from 'react-hot-toast';

interface UpdateNotificationProps {
  autoCheck?: boolean;
  showNotification?: boolean;
}

export function UpdateNotification({ 
  autoCheck = true, 
  showNotification = true 
}: UpdateNotificationProps) {
  const { updateInfo, isChecking, isInstalling, checkUpdates, install } = useUpdateChecker(autoCheck);

  const handleInstall = async () => {
    if (updateInfo?.available) {
      const confirmed = window.confirm(
        `Install update version ${updateInfo.version}?\n\n${updateInfo.body || ''}\n\nThe application will restart after installation.`
      );
      if (confirmed) {
        await install();
      }
    }
  };

  if (!showNotification || !updateInfo?.available) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 bg-blue-600 text-white p-4 rounded-lg shadow-lg max-w-md z-50">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-semibold text-lg mb-1">Update Available</h3>
          <p className="text-sm mb-2">
            Version {updateInfo.version} is now available. You're currently on version {updateInfo.current_version}.
          </p>
          {updateInfo.body && (
            <p className="text-xs text-blue-100 mb-3 whitespace-pre-wrap">
              {updateInfo.body}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleInstall}
              disabled={isInstalling}
              className="bg-white text-blue-600 px-4 py-2 rounded font-medium hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isInstalling ? 'Installing...' : 'Install Update'}
            </button>
            <button
              onClick={checkUpdates}
              disabled={isChecking || isInstalling}
              className="bg-blue-700 text-white px-4 py-2 rounded font-medium hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isChecking ? 'Checking...' : 'Check Again'}
            </button>
            <button
              onClick={() => {
                // Hide notification (you might want to store this in state)
                toast.dismiss();
              }}
              className="text-blue-100 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}



