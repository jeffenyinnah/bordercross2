import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'
import type { PricedVehicleType, PolicyDetails } from '@bordercross/core'
import type { OutboxItem } from './store/types'

// ---------------------------------------------------------------------------
// Server shapes (see supabase/migrations/20261023000300_device_offline_rpcs.sql)
// ---------------------------------------------------------------------------

export interface NumberLeaseRow {
  id: string
  border_code: string
  year: number
  start_seq: number
  end_seq: number
}

export interface CreditLeaseRow {
  id: string
  currency: string
  reserved: number | string
  consumed: number | string
  status: string
}

export interface Snapshot {
  server_time: string
  device_id: string
  profile: {
    id: string
    full_name: string
    email: string
    role: string
    insurer_id: string
    border_post_id: string | null
    is_active: boolean
  }
  insurer: { id: string; name: string; code: string; payment_methods: string[]; settings: unknown }
  wallet: { balance_mzn: number } | null
  vehicle_types: PricedVehicleType[]
  border_posts: { id: string; name: string; code: string }[]
  exchange_rates: { from_currency: string; to_currency: string; rate: number }[]
  terminals: unknown[]
  merchants: unknown[]
  slip_profiles: unknown[]
  dedupe: { txn_keys: string[]; image_hashes: string[]; card_amounts: unknown[]; recibos_by_tid: Record<string, number[]> }
  open_review_count: number
  number_leases: NumberLeaseRow[]
  credit_leases: CreditLeaseRow[]
}

/** The policies row as returned by issue_policy_online. */
export type PolicyRow = Record<string, unknown> & {
  id: string
  policy_number: string
  verification_token: string
  created_at: string
}

/** Answer of /api/sync/push: the server has the item (or kept it as a rejection). */
export type PushResult =
  | { result: 'created' | 'existing'; policy?: PolicyRow; payment?: Record<string, unknown> }
  | { result: 'rejected'; reason: string }

/** The request never reached the server or the answer was lost: safe to retry or go offline. */
export class NetworkError extends Error {}

/** The server answered with an error the agent must see (insufficient balance, revoked device...). */
export class ServerError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
  }
}

export interface AgentApi {
  signIn(email: string, password: string): Promise<{ userId: string }>
  signOut(): Promise<void>
  /**
   * User id of the stored session (works offline). undefined: a session exists
   * but its token expired and could not be refreshed without network.
   */
  sessionUserId(): Promise<string | null | undefined>
  registerDevice(input: { platform: string; model?: string; appVersion?: string; deviceId?: string }): Promise<string>
  snapshot(deviceId: string): Promise<Snapshot>
  leaseNumbers(deviceId: string, borderCode: string): Promise<NumberLeaseRow>
  /** reserve MZN from the wallet for offline credit sales on this device */
  leaseCredit(deviceId: string, amount?: number): Promise<CreditLeaseRow>
  issueOnline(deviceId: string, clientUuid: string, details: PolicyDetails): Promise<PolicyRow>
  /** push one outbox item; card payments carry their slip photo */
  pushOutbox(deviceId: string, item: OutboxItem, image: string | null): Promise<PushResult>
}

// ---------------------------------------------------------------------------
// Supabase implementation
// ---------------------------------------------------------------------------

function toError(error: { message: string; code?: string; status?: number } | null): Error {
  if (!error) return new ServerError('Unknown error')
  // supabase-js reports fetch failures with an empty code
  if (!error.code || /fetch|network|timeout/i.test(error.message)) {
    return new NetworkError(error.message || 'Network error')
  }
  return new ServerError(error.message, error.code)
}

/**
 * The agent app talks to Supabase with the web app's own client, so agents
 * sign in once at /login and the same (cookie) session works in /agent.
 */
export function createSupabaseApi(supabase: SupabaseClient): AgentApi {
  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    let result
    try {
      result = await supabase.rpc(fn, args)
    } catch (e) {
      throw new NetworkError(e instanceof Error ? e.message : String(e))
    }
    if (result.error) throw toError(result.error)
    return result.data as T
  }

  return {
    async signIn(email, password) {
      let result
      try {
        result = await supabase.auth.signInWithPassword({ email, password })
      } catch (e) {
        throw new NetworkError(e instanceof Error ? e.message : String(e))
      }
      if (result.error) {
        if (result.error.status === 0 || /fetch/i.test(result.error.message)) {
          throw new NetworkError('No connection. The first login needs internet.')
        }
        throw new ServerError(result.error.message, result.error.code)
      }
      return { userId: result.data.user.id }
    },
    async signOut() {
      await supabase.auth.signOut({ scope: 'local' })
    },
    async sessionUserId() {
      const { data, error } = await supabase.auth.getSession()
      if (data.session) return data.session.user.id
      // offline with an expired access token: the session is kept, just not refreshable yet
      if (error && isAuthRetryableFetchError(error)) return undefined
      return null
    },
    registerDevice: (i) => rpc<string>('register_device', {
      p_platform: i.platform, p_model: i.model ?? null, p_app_version: i.appVersion ?? null,
      p_public_key: null, p_device_id: i.deviceId ?? null,
    }),
    snapshot: (deviceId) => rpc<Snapshot>('get_device_snapshot', { p_device_id: deviceId }),
    leaseNumbers: (deviceId, borderCode) =>
      rpc<NumberLeaseRow>('lease_policy_numbers', { p_device_id: deviceId, p_border_code: borderCode }),
    leaseCredit: (deviceId, amount) =>
      rpc<CreditLeaseRow>('lease_offline_credit', { p_device_id: deviceId, p_currency: 'MZN', p_amount: amount ?? null }),
    issueOnline: (deviceId, clientUuid, details) =>
      rpc<PolicyRow>('issue_policy_online', { p_device_id: deviceId, p_client_uuid: clientUuid, p_details: details }),
    async pushOutbox(deviceId, item, image) {
      let response: Response
      try {
        // renews an expired access token (and its cookie) after a long offline stretch
        await supabase.auth.getSession()
        response = await fetch('/api/sync/push', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: deviceId, kind: item.kind, record: item.payload, image }),
        })
      } catch (e) {
        throw new NetworkError(e instanceof Error ? e.message : String(e))
      }
      const body = await response.json().catch(() => null) as (PushResult & { error?: string }) | null
      if (response.ok && body) return body
      // 401 signed out, 403 blocked phone or inactive account, 5xx server trouble: stop and retry later
      throw new ServerError(body?.error ?? `Sync refused (${response.status})`, String(response.status))
    },
  }
}
