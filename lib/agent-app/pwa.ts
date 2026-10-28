import { useSyncExternalStore } from 'react'
import { Serwist } from '@serwist/window'

/**
 * Service worker for /agent: the app opens and runs with no network. A new
 * version downloads in the background but only takes over when the agent taps
 * Update, so a release never reloads the app in the middle of a sale.
 */
let serwist: Serwist | null = null
let updateReady = false
const listeners = new Set<() => void>()

export function startServiceWorker() {
  if (serwist || !('serviceWorker' in navigator)) return
  // in development there is no precache; the worker would only get in the way
  if (process.env.NODE_ENV !== 'production') return
  serwist = new Serwist('/serwist/sw.js', { scope: '/agent', type: 'module' })
  serwist.addEventListener('waiting', () => {
    updateReady = true
    listeners.forEach((l) => l())
  })
  // the new worker took over: load the new version
  serwist.addEventListener('controlling', () => window.location.reload())
  void serwist.register()
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    () => updateReady,
    () => false,
  )
}

export function installUpdate() {
  serwist?.messageSkipWaiting()
}
