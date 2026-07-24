import { useState, useEffect } from 'react'
import { checkForUpdates, type UpdateInfo } from './updateApi'

export function useUpdateChecker(autoCheck = false) {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)

  const checkUpdates = async () => {
    setIsChecking(true)
    try {
      const info = await checkForUpdates()
      setUpdateInfo(info)
      return info
    } finally {
      setIsChecking(false)
    }
  }

  const install = async () => {
    setIsInstalling(true)
    try {
      return await import('./updateApi').then((m) => m.installUpdate())
    } finally {
      setIsInstalling(false)
    }
  }

  useEffect(() => {
    if (autoCheck) {
      checkUpdates()
    }
  }, [autoCheck])

  return { updateInfo, isChecking, isInstalling, checkUpdates, install }
}
