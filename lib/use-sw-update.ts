'use client'
import { useEffect, useState } from 'react'

// Detects when a new service worker is installed and waiting to take over.
// Triggering applyUpdate() posts SKIP_WAITING; the worker's controllerchange
// event then fires and the page reloads to pick up the new bundle.
export function useServiceWorkerUpdate(): { updateReady: boolean; applyUpdate: () => void } {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    let cancelled = false

    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg || cancelled) return
      // A worker installed during a previous tab life is already waiting.
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(installing)
          }
        })
      })
    }).catch(() => {})

    // Snapshot whether the page had a controller at load time. If it didn't,
    // any controllerchange we see is the FIRST-EVER activation of the worker
    // on this device/origin — not an update — and reloading would force an
    // unwanted second page load (visible as the 4-second flicker users
    // reported after signing in via SSO to a freshly-installed PWA).
    const hadControllerOnLoad = !!navigator.serviceWorker.controller

    let reloading = false
    const onControllerChange = () => {
      if (!hadControllerOnLoad) return
      if (reloading) return
      reloading = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  function applyUpdate() {
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  return { updateReady: !!waiting, applyUpdate }
}
