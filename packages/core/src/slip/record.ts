import { z } from 'zod'
import { PRICE_CURRENCY } from '../money'
import type { ValidationResult, Tier } from '../validation/engine'
import type { ConfirmedSlip } from './confirm'
import { SLIP_FIELDS, type OcrResult, type SlipFieldName } from './parser'
import { maskPan } from './text'

export const CARD_PAYMENT_STATUSES = ['PENDING_RECONCILIATION', 'NEEDS_REVIEW', 'DECLINED'] as const
export type CardPaymentStatus = (typeof CARD_PAYMENT_STATUSES)[number]

/** Status a payment starts with on the device (policy_payments.status). */
export function cardPaymentStatus(tier: Tier): CardPaymentStatus {
  switch (tier) {
    case 'AUTO_PASS': return 'PENDING_RECONCILIATION'
    case 'ISSUE_WITH_FLAG': return 'NEEDS_REVIEW'
    case 'HARD_DECLINE': return 'DECLINED'
  }
}

const fieldMap = <T extends z.ZodType>(t: T) =>
  z.object(Object.fromEntries(SLIP_FIELDS.map((f) => [f, t])) as Record<SlipFieldName, T>)

/**
 * A card-slip payment captured on the device, as queued in the outbox. It keeps
 * the raw evidence (masked OCR lines, edits, confirmations, capture metadata) so
 * the server can re-run parseSlip + confirmSlip + validateSlip during sync and
 * reach its own verdict. Declined attempts are kept too (policy_client_uuid null).
 */
export const cardPaymentRecordSchema = z.object({
  client_uuid: z.uuid(),
  /** the policy this slip paid for; null when the slip was declined */
  policy_client_uuid: z.uuid().nullable(),
  device_id: z.uuid(),
  agent_id: z.uuid(),
  insurer_id: z.uuid(),
  border_post_id: z.uuid().nullable(),
  method: z.literal('POS_CARD_SLIP'),
  status: z.enum(CARD_PAYMENT_STATUSES),
  tier: z.enum(['AUTO_PASS', 'ISSUE_WITH_FLAG', 'HARD_DECLINE']),
  expected_amount: z.string().regex(/^\d+\.\d{2}$/),
  expected_currency: z.literal(PRICE_CURRENCY),
  /** final values after the agent's review */
  fields: fieldMap(z.string().nullable()),
  field_confidence: fieldMap(z.number().min(0).max(1)),
  /** OCR output with any full card number masked */
  ocr_lines: z.array(z.object({ text: z.string(), confidence: z.number().min(0).max(1).optional() })),
  edits: z.array(z.object({
    field: z.enum(SLIP_FIELDS),
    ocr_value: z.string().nullable(),
    edited_value: z.string().nullable(),
    at: z.string(),
  })),
  confirmed: z.array(z.enum(SLIP_FIELDS)),
  checks: z.array(z.object({
    id: z.string(),
    pass: z.boolean(),
    severity: z.enum(['HARD', 'FLAG']),
    expected: z.string().nullable().optional(),
    actual: z.string().nullable().optional(),
    message: z.string(),
  })),
  flags: z.array(z.string()),
  txn_key: z.string().nullable(),
  matched_terminal_id: z.string().nullable(),
  slip_profile_id: z.uuid().nullable(),
  slip_profile_version: z.number().int(),
  image_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  in_app_capture: z.boolean(),
  captured_at: z.iso.datetime({ offset: true }),
  gps: z.object({ lat: z.number(), lng: z.number(), accuracy_m: z.number().nullable() }).nullable(),
  /** device times: premium shown to the agent / payment recorded */
  policy_created_at: z.iso.datetime({ offset: true }),
  device_created_at: z.iso.datetime({ offset: true }),
  /** server time minus device time at the last sync (null = never measured) */
  clock_offset_ms: z.number().nullable(),
})

export type CardPaymentRecord = z.infer<typeof cardPaymentRecordSchema>

export function buildCardPaymentRecord(input: {
  clientUuid: string
  policyClientUuid: string | null
  deviceId: string
  agentId: string
  insurerId: string
  borderPostId: string | null
  expected: { amount: string; currency: typeof PRICE_CURRENCY }
  ocr: OcrResult
  slip: ConfirmedSlip
  result: ValidationResult
  profile: { id: string | null; version: number }
  capture: {
    inApp: boolean
    capturedAt: string
    imageSha256: string
    gps: { lat: number; lng: number; accuracyM: number | null } | null
  }
  policyCreatedAt: string
  createdAt: string
  clockOffsetMs: number | null
}): CardPaymentRecord {
  const { slip, result } = input
  return {
    client_uuid: input.clientUuid,
    policy_client_uuid: result.tier === 'HARD_DECLINE' ? null : input.policyClientUuid,
    device_id: input.deviceId,
    agent_id: input.agentId,
    insurer_id: input.insurerId,
    border_post_id: input.borderPostId,
    method: 'POS_CARD_SLIP',
    status: cardPaymentStatus(result.tier),
    tier: result.tier,
    expected_amount: input.expected.amount,
    expected_currency: input.expected.currency,
    fields: slip.values,
    field_confidence: slip.confidence,
    ocr_lines: input.ocr.lines.map((l) => ({ text: maskPan(l.text), confidence: l.confidence })),
    edits: slip.edits,
    confirmed: slip.confirmed,
    checks: result.checks.map(({ id, pass, severity, expected, actual, message }) =>
      ({ id, pass, severity, expected, actual, message })),
    flags: result.flags,
    txn_key: result.resolved.txnKey,
    matched_terminal_id: result.resolved.terminalId,
    slip_profile_id: input.profile.id,
    slip_profile_version: input.profile.version,
    image_sha256: input.capture.imageSha256,
    in_app_capture: input.capture.inApp,
    captured_at: input.capture.capturedAt,
    gps: input.capture.gps
      ? { lat: input.capture.gps.lat, lng: input.capture.gps.lng, accuracy_m: input.capture.gps.accuracyM }
      : null,
    policy_created_at: input.policyCreatedAt,
    device_created_at: input.createdAt,
    clock_offset_ms: input.clockOffsetMs,
  }
}
