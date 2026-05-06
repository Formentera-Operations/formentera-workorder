'use client'
import { useEffect, useState } from 'react'

// Tracks browser online status. Returns true on the server / initial render to
// avoid an "offline flash" before hydration.
export function useOnline(): boolean {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    if (typeof navigator !== 'undefined') setOnline(navigator.onLine)
    function on() { setOnline(true) }
    function off() { setOnline(false) }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
