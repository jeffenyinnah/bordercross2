import 'server-only'

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SIMO_REDE_PROFILE,
  cardPaymentRecordSchema,
  offlinePolicyRecordSchema,
  parseInsurerSettings,
  parseSlipProfile,
  revalidateCardPayment,
  type DedupeIndex,
  type SlipProfileConfig,
  type Whitelist,
} from '@bordercross/core'
import { createAdminClient } from '@/lib/supabase/admin'

export const SLIP_BUCKET = 'card-slips'

/** One outbox item as the phone sends it. */
export interface PushRequest {
  device_id: string
  kind: 'policy' | 'card_payment'
  record: unknown
  /** card payments: the slip photo, JPEG base64 */
  image?: string | null
}

export type PushResult =
  | { result: 'created' | 'existing'; policy?: Record<string, unknown>; payment?: Record<string, unknown> }
  | { result: 'rejected'; reason: string }

/** The phone must stop syncing: signed out, inactive, or a blocked phone. */
export class PushForbidden extends Error {}

interface Snapshot {
  insurer: { settings: unknown }
  terminals: Whitelist['terminals']
  merchants: Whitelist['merchants']
  slip_profiles: { id: string; config: unknown }[]
  dedupe: { txn_keys: string[]; image_hashes: string[]; card_amounts: DedupeIndex['cardAmounts']; recibos_by_tid: Record<string, number[]> }
  server_time: string
}

function fail(error: { code?: string; message: string }): never {
  if (error.code === '42501') throw new PushForbidden(error.message)
  throw new Error(error.message)
}

/** Kept for the back office: a record the server could not even read. */
async function rejectUnreadable(
  admin: SupabaseClient, agentId: string, req: PushRequest, reason: string,
): Promise<PushResult> {
  const record = (req.record ?? {}) as Record<string, unknown>
  const clientUuid = typeof record.client_uuid === 'string' ? record.client_uuid : null
  const { data: profile } = await admin.from('profiles').select('insurer_id').eq('id', agentId).single()
  if (!clientUuid || !profile?.insurer_id) throw new Error(`Unreadable record: ${reason}`)
  const { error } = await admin.from('sync_rejections').upsert({
    client_uuid: clientUuid, kind: req.kind, device_id: req.device_id, agent_id: agentId,
    insurer_id: profile.insurer_id, reason, payload: record,
  }, { onConflict: 'client_uuid,kind', ignoreDuplicates: true })
  if (error) fail(error)
  return { result: 'rejected', reason }
}

/**
 * Store one pushed outbox item. `user` is the agent's own client (cookie
 * session): it proves who is calling and that the phone is theirs. The writes
 * use the service role, so only this code can record a verdict.
 */
export async function pushItem(user: SupabaseClient, agentId: string, req: PushRequest): Promise<PushResult> {
  const admin = createAdminClient()

  if (req.kind === 'policy') {
    const parsed = offlinePolicyRecordSchema.safeParse(req.record)
    if (!parsed.success) return rejectUnreadable(admin, agentId, req, parsed.error.issues[0].message)
    const { data, error } = await admin.rpc('sync_offline_policy', {
      p_agent_id: agentId, p_device_id: req.device_id, p_record: parsed.data,
    })
    if (error) fail(error)
    return data as PushResult
  }

  const parsed = cardPaymentRecordSchema.safeParse(req.record)
  if (!parsed.success) return rejectUnreadable(admin, agentId, req, parsed.error.issues[0].message)
  const record = parsed.data

  const { data: existing } = await admin.from('policy_payments').select('*')
    .eq('client_uuid', record.client_uuid).maybeSingle()
  if (existing) return { result: 'existing', payment: existing }

  // the agent's own snapshot: checks the phone and holds the insurer's full dedupe data
  const { data: snap, error: snapError } = await user.rpc('get_device_snapshot', { p_device_id: req.device_id })
  if (snapError) fail(snapError)
  const snapshot = snap as Snapshot

  let imagePath: string | null = null
  const flags: string[] = []
  if (req.image) {
    const bytes = Buffer.from(req.image, 'base64')
    if (createHash('sha256').update(bytes).digest('hex') === record.image_sha256) {
      imagePath = `${record.insurer_id}/${agentId}/${record.client_uuid}.jpg`
      const { error } = await admin.storage.from(SLIP_BUCKET)
        .upload(imagePath, bytes, { contentType: 'image/jpeg', upsert: true })
      if (error) throw new Error(`Photo upload failed: ${error.message}`)
    } else {
      flags.push('IMAGE_HASH_MISMATCH')
    }
  }

  let profile: SlipProfileConfig = SIMO_REDE_PROFILE
  const stored = snapshot.slip_profiles.find((p) => p.id === record.slip_profile_id)
  if (stored) {
    try {
      profile = parseSlipProfile(stored.config)
    } catch {
      // fall back to the built-in layout
    }
  }

  const verdict = revalidateCardPayment(record, {
    settings: parseInsurerSettings(snapshot.insurer.settings),
    profile,
    whitelist: { terminals: snapshot.terminals, merchants: snapshot.merchants, updatedAt: snapshot.server_time },
    dedupe: {
      txnKeys: snapshot.dedupe.txn_keys,
      imageHashes: snapshot.dedupe.image_hashes,
      cardAmounts: snapshot.dedupe.card_amounts,
      recibosByTid: snapshot.dedupe.recibos_by_tid,
    },
    agent: { id: agentId, insurerId: record.insurer_id },
    imageVerified: imagePath !== null,
  })

  const { data, error } = await admin.rpc('sync_card_payment', {
    p_agent_id: agentId,
    p_device_id: req.device_id,
    p_record: record,
    p_verdict: {
      status: verdict.status,
      tier: verdict.tier,
      checks: verdict.checks,
      flags: [...new Set([...verdict.flags, ...flags])],
      matched_terminal_id: verdict.matched_terminal_id,
      image_path: imagePath,
    },
  })
  if (error) fail(error)
  return data as PushResult
}
