import { createContext, useContext } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AgentService, type DeviceInfo } from './agent'
import { createSupabaseApi } from './api'
import { IdbStore } from './store/idb'
import type { LocalStore } from './store/types'
import { config } from './config'

export interface Services {
  store: LocalStore
  agent: AgentService
}

export const isAndroid = () => /Android/i.test(navigator.userAgent)

async function deviceInfo(): Promise<DeviceInfo> {
  const ua = navigator as Navigator & {
    userAgentData?: { getHighEntropyValues(hints: string[]): Promise<{ model?: string }> }
  }
  let model: string | undefined
  try {
    model = (await ua.userAgentData?.getHighEntropyValues(['model']))?.model || undefined
  } catch {
    // not available in every browser
  }
  return { platform: isAndroid() ? 'android' : 'web', model, appVersion: config.appVersion }
}

export async function createServices(): Promise<Services> {
  const store = await IdbStore.open()
  // the web app's browser client: same cookie session as /login
  const api = createSupabaseApi(createClient())
  const agent = new AgentService(store, api, await deviceInfo())
  return { store, agent }
}

export const ServicesContext = createContext<Services | null>(null)

export function useServices(): Services {
  const s = useContext(ServicesContext)
  if (!s) throw new Error('ServicesContext missing')
  return s
}
