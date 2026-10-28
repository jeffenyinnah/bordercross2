import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INSURER_SETTINGS, SIMO_REDE_PROFILE, buildCardPaymentRecord, cardPaymentRecordSchema,
  cardPaymentStatus, confirmSlip, linesFromText, parseSlip, revalidateCardPayment, validateSlip,
  type ServerSlipContext, type ValidationContext,
} from '../src'
import { SLIP_1, withLine } from './fixtures/slips'

const AT = '2026-10-11T13:41:00+02:00'
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const ctx: ValidationContext = {
  expected: { amountMinor: 300000, currency: 'MZN' },
  agent: { id: U(1), insurerId: U(2), borderPostId: U(3) },
  policyCreatedAt: '2026-10-11T13:36:00+02:00',
  now: AT,
  clockOffsetMs: 0,
  whitelist: {
    terminals: [{ id: U(4), tid: '00236255', mid: '000000000130941', insurer_id: U(2), assigned_agent_id: U(1), border_post_id: U(3), is_active: true }],
    merchants: [{ id: U(5), mid: '000000000130941', insurer_id: U(2), is_active: true }],
    updatedAt: '2026-10-11T12:00:00+02:00',
  },
  dedupe: { txnKeys: [], imageHashes: [], cardAmounts: [], recibosByTid: {} },
  capture: { inApp: true, capturedAt: '2026-10-11T13:40:30+02:00', imageSha256: 'a'.repeat(64), gps: null },
  exposure: { openCount: 0, openValueMinor: 0 },
}

function record(text: string) {
  const ocr = linesFromText(text)
  const slip = confirmSlip(parseSlip(ocr, SIMO_REDE_PROFILE), SIMO_REDE_PROFILE, { at: AT })
  const result = validateSlip(slip, ctx, DEFAULT_INSURER_SETTINGS)
  return buildCardPaymentRecord({
    clientUuid: U(10), policyClientUuid: U(11), deviceId: U(12), agentId: U(1), insurerId: U(2), borderPostId: U(3),
    expected: { amount: '3000.00', currency: 'MZN' }, ocr, slip, result,
    profile: { id: null, version: SIMO_REDE_PROFILE.version },
    capture: { ...ctx.capture }, policyCreatedAt: ctx.policyCreatedAt, createdAt: AT, clockOffsetMs: 0,
  })
}

describe('card payment record', () => {
  it('maps tiers to the initial payment status', () => {
    expect(cardPaymentStatus('AUTO_PASS')).toBe('PENDING_RECONCILIATION')
    expect(cardPaymentStatus('ISSUE_WITH_FLAG')).toBe('NEEDS_REVIEW')
    expect(cardPaymentStatus('HARD_DECLINE')).toBe('DECLINED')
  })

  it('an accepted slip links its policy and passes the sync schema', () => {
    const r = cardPaymentRecordSchema.parse(record(SLIP_1))
    expect(r).toMatchObject({ status: 'PENDING_RECONCILIATION', policy_client_uuid: U(11), matched_terminal_id: U(4) })
    expect(r.txn_key).toBe('00236255|628451143467|727255|2026-10-11T11:39:54.000Z')
  })

  it('a declined slip is kept without a policy, and never stores a full card number', () => {
    const text = withLine(withLine(SLIP_1, 'MONTANTE:      3000.00 MZN', 'MONTANTE:      30.00 MZN'),
      'XXXXXXXXXXXX8622', '4111111111118622')
    const r = cardPaymentRecordSchema.parse(record(text))
    expect(r).toMatchObject({ status: 'DECLINED', tier: 'HARD_DECLINE', policy_client_uuid: null })
    expect(JSON.stringify(r)).not.toContain('4111111111118622')
  })
})

describe('server re-validation at sync', () => {
  const server = (over: Partial<ServerSlipContext> = {}): ServerSlipContext => ({
    settings: DEFAULT_INSURER_SETTINGS,
    profile: SIMO_REDE_PROFILE,
    whitelist: { ...ctx.whitelist, updatedAt: '2026-10-12T09:00:00+02:00' },
    dedupe: { txnKeys: [], imageHashes: [], cardAmounts: [], recibosByTid: {} },
    agent: { id: U(1), insurerId: U(2) },
    imageVerified: true,
    ...over,
  })

  it('reaches the same verdict as the phone with the same data, a day later', () => {
    const r = cardPaymentRecordSchema.parse(record(SLIP_1))
    expect(revalidateCardPayment(r, server())).toMatchObject({
      status: 'PENDING_RECONCILIATION', tier: 'AUTO_PASS', matched_terminal_id: U(4),
    })
  })

  it('a slip already used on another phone becomes a conflict, not a second payment', () => {
    const r = cardPaymentRecordSchema.parse(record(SLIP_1))
    const v = revalidateCardPayment(r, server({ dedupe: { txnKeys: [r.txn_key!], imageHashes: [], cardAmounts: [], recibosByTid: {} } }))
    expect(v.status).toBe('CONFLICT')
    expect(v.tier).toBe('ISSUE_WITH_FLAG')
    expect(v.flags).toContain('SERVER_DECLINED')
  })

  it('a terminal deactivated meanwhile is a conflict', () => {
    const r = cardPaymentRecordSchema.parse(record(SLIP_1))
    const whitelist = { ...ctx.whitelist, terminals: ctx.whitelist.terminals.map((t) => ({ ...t, is_active: false })) }
    expect(revalidateCardPayment(r, server({ whitelist })).status).toBe('CONFLICT')
  })

  it('a missing photo sends the payment to review', () => {
    const r = cardPaymentRecordSchema.parse(record(SLIP_1))
    const v = revalidateCardPayment(r, server({ imageVerified: false }))
    expect(v).toMatchObject({ status: 'NEEDS_REVIEW', tier: 'ISSUE_WITH_FLAG' })
    expect(v.flags).toContain('IMAGE_MISSING')
  })

  it('receipt order seen only at sync is not a reason to review', () => {
    const r = cardPaymentRecordSchema.parse(record(SLIP_1))
    const recibo = Number(r.fields.recibo_no)
    const v = revalidateCardPayment(r, server({ dedupe: { txnKeys: [], imageHashes: [], cardAmounts: [], recibosByTid: { '00236255': [recibo + 5] } } }))
    expect(v.status).toBe('PENDING_RECONCILIATION')
  })

  it('a declined attempt stays declined', () => {
    const text = withLine(SLIP_1, 'MONTANTE:      3000.00 MZN', 'MONTANTE:      30.00 MZN')
    const r = cardPaymentRecordSchema.parse(record(text))
    expect(revalidateCardPayment(r, server())).toMatchObject({ status: 'DECLINED', tier: 'HARD_DECLINE' })
  })
})
