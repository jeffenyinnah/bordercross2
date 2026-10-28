import { describe, expect, it } from 'vitest'
import {
  availableCredit,
  formatPolicyNumber,
  generateVerificationToken,
  issueOfflinePolicy,
  mergeCreditLeases,
  needsNumberRefill,
  offlinePolicyRecordSchema,
  remainingNumbers,
  takePolicyNumber,
  toLocalNumberLease,
  type LocalCreditLease,
  type LocalNumberLease,
  type OfflineIssueContext,
  type OfflineIssueState,
  type PricedVehicleType,
} from '../src'

const INSURER = '11111111-1111-4111-8111-111111111111'
const LIGHT = '22222222-2222-4222-8222-222222222222'
const TRAILER = '33333333-3333-4333-8333-333333333333'

const vt = (id: string, name: string, mzn: number): PricedVehicleType => ({
  id, name, is_active: true, insurer_id: null,
  price_mzn: mzn,
  price_mzn_annual: mzn * 10,
})

const lease = (id: string, start: number, end: number, next = start): LocalNumberLease =>
  ({ id, border_code: 'RGAR', year: 2026, start_seq: start, end_seq: end, next_seq: next })

const credit = (id: string, reserved: number, local = 0): LocalCreditLease =>
  ({ id, reservedMinor: reserved, serverConsumedMinor: 0, localConsumedMinor: local })

const details = {
  policy_type: 'monthly' as const,
  currency: 'MZN' as const,
  vehicle_type_ids: [LIGHT, TRAILER],
  client_name: 'Joao Silva',
  plate_number: 'ABC 123 GP',
  vehicle_brand: 'Toyota',
  vehicle_model: 'Hilux',
  start_date: '2026-10-23',
}

const state = (over: Partial<OfflineIssueState> = {}): OfflineIssueState => ({
  vehicleTypes: [vt(LIGHT, 'Light', 1000), vt(TRAILER, 'Trailer', 500.5)],
  priceVersion: '2026-10-23T07:00:00.000Z',
  numberLeases: [lease('44444444-4444-4444-8444-444444444441', 51, 100), lease('44444444-4444-4444-8444-444444444440', 1, 50, 50)],
  creditLeases: [credit('55555555-5555-4555-8555-555555555555', 1_000_000)],
  allowedMethods: ['VIRTUAL_CREDIT', 'POS_CARD_SLIP'],
  ...over,
})

const ctx = (over: Partial<OfflineIssueContext> = {}): OfflineIssueContext => ({
  clientUuid: '66666666-6666-4666-8666-666666666666',
  deviceId: '77777777-7777-4777-8777-777777777777',
  agentId: '88888888-8888-4888-8888-888888888888',
  insurerId: INSURER,
  border: { code: 'rgar', name: 'Ressano Garcia' },
  paymentMethod: 'VIRTUAL_CREDIT',
  verificationToken: 'a'.repeat(32),
  now: new Date('2026-10-23T08:00:00Z'),
  ...over,
})

describe('policy numbering', () => {
  it('formats like generate_policy_number', () => {
    expect(formatPolicyNumber('rgar', 2026, 101)).toBe('RGAR-2026-000101')
  })

  it('hands out the oldest block first and never mutates input', () => {
    const leases = state().numberLeases
    const a = takePolicyNumber(leases, 'RGAR', 2026)!
    expect(a.number).toBe('RGAR-2026-000050')
    const b = takePolicyNumber(a.leases, 'RGAR', 2026)!
    expect(b.number).toBe('RGAR-2026-000051')
    expect(leases[1].next_seq).toBe(50)
    expect(remainingNumbers(b.leases, 'RGAR', 2026)).toBe(49)
  })

  it('returns null when blocks are exhausted, for another border or another year', () => {
    expect(takePolicyNumber([lease('x', 1, 2, 3)], 'RGAR', 2026)).toBeNull()
    expect(takePolicyNumber([lease('x', 1, 2)], 'NAMA', 2026)).toBeNull()
    expect(takePolicyNumber([lease('x', 1, 2)], 'RGAR', 2027)).toBeNull()
  })

  it('asks for a refill when less than half a block is left', () => {
    expect(needsNumberRefill([lease('x', 1, 50, 26)], 'RGAR', 2026, 50)).toBe(false)
    expect(needsNumberRefill([lease('x', 1, 50, 27)], 'RGAR', 2026, 50)).toBe(true)
  })

  it('keeps local progress when the snapshot repeats a known lease', () => {
    const row = { id: 'x', border_code: 'RGAR', year: 2026, start_seq: 1, end_seq: 50 }
    expect(toLocalNumberLease(row).next_seq).toBe(1)
    expect(toLocalNumberLease(row, lease('x', 1, 50, 30)).next_seq).toBe(30)
  })
})

describe('offline credit', () => {
  it('spends only reserved, unspent credit', () => {
    const leases = [credit('a', 1000, 900), credit('b', 5000)]
    expect(availableCredit(leases)).toBe(5100)
  })

  it('keeps unacknowledged local spending when the server snapshot arrives', () => {
    const merged = mergeCreditLeases(
      [{ id: 'a', currency: 'MZN', reserved: '10000.00', consumed: '1000.00' }], { a: 50_000 })
    expect(merged[0]).toEqual({
      id: 'a', reservedMinor: 1_000_000, serverConsumedMinor: 100_000, localConsumedMinor: 50_000,
    })
    expect(availableCredit(merged)).toBe(850_000)
  })
})

describe('issueOfflinePolicy', () => {
  it('prices, numbers and debits the reserve like the online RPC', () => {
    const r = issueOfflinePolicy(details, state(), ctx())
    if (!r.ok) throw new Error(r.error)
    expect(r.record.premium_amount).toBe('1500.50')
    expect(r.record.policy_number).toBe('RGAR-2026-000050')
    expect(r.record.end_date).toBe('2026-11-22')
    expect(r.record.border).toBe('Ressano Garcia')
    expect(r.record.border_code).toBe('RGAR')
    expect(r.record.notes).toBe('Coverage: Light + Trailer')
    expect(r.record.credit_lease_id).toBe('55555555-5555-4555-8555-555555555555')
    expect(availableCredit(r.creditLeases)).toBe(1_000_000 - 150_050)
    expect(offlinePolicyRecordSchema.safeParse(r.record).success).toBe(true)
  })

  it('does not touch credit for a card-slip sale', () => {
    const r = issueOfflinePolicy(details, state(), ctx({ paymentMethod: 'POS_CARD_SLIP' }))
    if (!r.ok) throw new Error(r.error)
    expect(r.record.credit_lease_id).toBeNull()
    expect(r.creditLeases).toEqual(state().creditLeases)
  })

  it('refuses when the reserve is too small, without consuming a number', () => {
    const s = state({ creditLeases: [credit('55555555-5555-4555-8555-555555555555', 100_000)] })
    const r = issueOfflinePolicy(details, s, ctx())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Not enough offline credit for 1500.50 MZN/)
  })

  it('refuses without numbers, with a disabled method, or with bad input', () => {
    expect(issueOfflinePolicy(details, state({ numberLeases: [] }), ctx()).ok).toBe(false)
    expect(issueOfflinePolicy(details, state({ allowedMethods: ['VIRTUAL_CREDIT'] }),
      ctx({ paymentMethod: 'POS_CARD_SLIP' })).ok).toBe(false)
    expect(issueOfflinePolicy({ ...details, plate_number: ' ' }, state(), ctx()).ok).toBe(false)
    expect(issueOfflinePolicy({ ...details, currency: 'ZAR' as 'MZN' }, state(), ctx()).ok).toBe(false)
  })

  it('uses vehicle types of the agent insurer only', () => {
    const other = { ...vt(LIGHT, 'Light', 1000), insurer_id: '99999999-9999-4999-8999-999999999999' }
    const r = issueOfflinePolicy({ ...details, vehicle_type_ids: [LIGHT] }, state({ vehicleTypes: [other] }), ctx())
    expect(r.ok).toBe(false)
  })
})

describe('verification token', () => {
  it('is 32 lowercase hex characters and random', () => {
    const a = generateVerificationToken()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(generateVerificationToken()).not.toBe(a)
  })
})
