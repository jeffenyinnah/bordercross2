import { PRICE_CURRENCY, toMinor } from '../money'
import type { InsurerSettings } from '../settings'
import { validateSlip, type DedupeIndex, type Tier, type ValidationResult, type Whitelist } from '../validation/engine'
import { normalizeFieldInput, type ConfirmedSlip } from './confirm'
import { SLIP_FIELDS, type SlipFieldName } from './parser'
import type { SlipProfileConfig } from './profile'
import type { CardPaymentRecord } from './record'

/** What the server knows when a phone syncs a card payment. */
export interface ServerSlipContext {
  settings: InsurerSettings
  /** the profile the phone parsed with (by slip_profile_id), or the default */
  profile: SlipProfileConfig
  /** the insurer's current terminals and merchants */
  whitelist: Whitelist
  /** every live payment on the server, this one excluded */
  dedupe: DedupeIndex
  agent: { id: string; insurerId: string }
  /** the photo arrived and its SHA-256 matches the record */
  imageVerified: boolean
}

export type ServerPaymentStatus = 'PENDING_RECONCILIATION' | 'NEEDS_REVIEW' | 'CONFLICT' | 'DECLINED'

export interface ServerVerdict {
  status: ServerPaymentStatus
  tier: Tier
  checks: CardPaymentRecord['checks']
  flags: string[]
  matched_terminal_id: string | null
}

/**
 * Flags that depend on the order phones sync in, not on the slip: an offline
 * sale synced after a later one on the same terminal looks out of order.
 */
const ORDER_FLAGS = new Set(['RECIBO_GAP', 'RECIBO_OUT_OF_ORDER', 'WHITELIST_STALE'])

const TIER_RANK: Record<Tier, number> = { AUTO_PASS: 0, ISSUE_WITH_FLAG: 1, HARD_DECLINE: 2 }

/** The confirmed slip as the phone validated it, rebuilt from the synced record. */
export function slipFromRecord(record: CardPaymentRecord, profile: SlipProfileConfig): ConfirmedSlip {
  const valid = {} as Record<SlipFieldName, boolean>
  for (const f of SLIP_FIELDS) {
    valid[f] = record.fields[f] !== null && normalizeFieldInput(f, record.fields[f], profile).valid
  }
  return {
    values: record.fields,
    valid,
    confidence: record.field_confidence,
    edits: record.edits,
    confirmed: record.confirmed,
    // the OCR lines were masked on the phone, so this warning only survives as a flag
    warnings: record.flags.includes('UNMASKED_PAN_SEEN') ? ['UNMASKED_PAN_SEEN'] : [],
  }
}

/**
 * Re-run the phone's slip validation with the server's data (full duplicate
 * history, current whitelist) at the moment the phone validated it, and decide
 * the stored status:
 * - a slip the phone declined stays declined;
 * - an issued policy whose slip the server would decline becomes CONFLICT;
 * - new server flags, or a missing photo, send it to review;
 * - otherwise the phone's status stands.
 */
export function revalidateCardPayment(record: CardPaymentRecord, ctx: ServerSlipContext): ServerVerdict & {
  result: ValidationResult
} {
  const slip = slipFromRecord(record, ctx.profile)
  const result = validateSlip(slip, {
    expected: { amountMinor: toMinor(record.expected_amount), currency: PRICE_CURRENCY },
    agent: { id: ctx.agent.id, insurerId: ctx.agent.insurerId, borderPostId: record.border_post_id },
    policyCreatedAt: record.policy_created_at,
    // validate as of when the phone did: capture age and slip window are judged then
    now: record.device_created_at,
    clockOffsetMs: record.clock_offset_ms,
    whitelist: ctx.whitelist,
    dedupe: ctx.dedupe,
    capture: {
      inApp: record.in_app_capture,
      capturedAt: record.captured_at,
      imageSha256: record.image_sha256,
      gps: record.gps ? { lat: record.gps.lat, lng: record.gps.lng, accuracyM: record.gps.accuracy_m } : null,
    },
    // the exposure cap limits issuing on the phone; it says nothing about this slip
    exposure: { openCount: 0, openValueMinor: 0 },
  }, ctx.settings)

  const checks = result.checks.map(({ id, pass, severity, expected, actual, message }) =>
    ({ id, pass, severity, expected, actual, message }))
  const deviceFlags = new Set(record.flags)
  const newFlags = result.flags.filter((f) => !deviceFlags.has(f) && !ORDER_FLAGS.has(f))
  const flags = [...new Set([...record.flags, ...result.flags.filter((f) => !ORDER_FLAGS.has(f))])]
  if (!ctx.imageVerified) flags.push('IMAGE_MISSING')
  const matched = result.resolved.terminalId

  if (record.status === 'DECLINED') {
    return { status: 'DECLINED', tier: 'HARD_DECLINE', checks, flags, matched_terminal_id: matched, result }
  }
  if (result.tier === 'HARD_DECLINE') {
    return {
      status: 'CONFLICT', tier: 'ISSUE_WITH_FLAG', checks,
      flags: [...flags, 'SERVER_DECLINED'], matched_terminal_id: matched, result,
    }
  }
  const tier = TIER_RANK[result.tier] > TIER_RANK[record.tier] ? result.tier : record.tier
  const review = record.status === 'NEEDS_REVIEW' || newFlags.length > 0 || !ctx.imageVerified
  return {
    status: review ? 'NEEDS_REVIEW' : 'PENDING_RECONCILIATION',
    tier: review && tier === 'AUTO_PASS' ? 'ISSUE_WITH_FLAG' : tier,
    checks, flags, matched_terminal_id: matched, result,
  }
}
