/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { Serwist } from 'serwist'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

// Precache only: the agent app shell, its chunks and the OCR assets. Supabase calls are
// never cached here; the app keeps its own data in IndexedDB.
// skipWaiting is off so an update never swaps code under an agent mid-sale; the app
// shows an "update ready" banner and asks the worker to activate.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  precacheOptions: {
    cleanupOutdatedCaches: true,
    ignoreURLParametersMatching: [/.*/],
  },
})

serwist.addEventListeners()
