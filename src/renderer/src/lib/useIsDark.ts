import { useEffect, useState } from 'react'
import { useAppStore } from '@renderer/store/useAppStore'

/**
 * Resolve the app's light/dark preference to a live boolean, following the OS
 * appearance while the preference is 'system' (so "follow system" doesn't leave
 * an editor stuck on light while the rest of the app is dark).
 */
export function useIsDark(): boolean {
  const theme = useAppStore((s) => s.settings.theme)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    if (theme !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = (): void => setSystemDark(mql.matches)
    sync() // re-read in case the OS toggled while we weren't following it
    mql.addEventListener('change', sync)
    return () => mql.removeEventListener('change', sync)
  }, [theme])
  return theme === 'dark' || (theme === 'system' && systemDark)
}
