import { describe, expect, it } from 'vitest'
import { calculateEndDate, computePremium, formatMinor, parseInsurerSettings, referenceAmounts, toMinor, type PricedVehicleType } from '../src'

const vt = (o: Partial<PricedVehicleType> & { id: string; name: string }): PricedVehicleType => ({
  is_active: true,
  insurer_id: null,
  price_mzn: 1000,
  price_mzn_annual: null,
  ...o,
})

const types = [
  vt({ id: 'light', name: 'Light' }),
  vt({ id: 'trailer', name: 'Trailer', price_mzn: 500, price_mzn_annual: 4500 }),
  vt({ id: 'cents', name: 'Cents', price_mzn: 0.1 }),
  vt({ id: 'off', name: 'Retired', is_active: false }),
  vt({ id: 'b-only', name: 'B only', insurer_id: 'ins-b' }),
]

describe('computePremium (mirrors create_policy_with_debit)', () => {
  it('sums the selected types and builds the coverage note', () => {
    const r = computePremium({ vehicleTypes: types, selectedIds: ['trailer', 'light'], policyType: 'monthly' })
    expect(r).toMatchObject({ ok: true, premium: 1500, premiumMinor: 150000, coverageNote: 'Coverage: Light + Trailer' })
  })

  it('counts a type selected twice only once', () => {
    const r = computePremium({ vehicleTypes: types, selectedIds: ['light', 'light'], policyType: 'monthly' })
    expect(r).toMatchObject({ ok: true, premium: 1000, coverageNote: null })
  })

  it('adds money exactly (no float drift)', () => {
    const r = computePremium({ vehicleTypes: types, selectedIds: ['cents', 'light'], policyType: 'monthly' })
    expect(r.ok && r.premium).toBe(1000.1)
    expect(r.ok && formatMinor(r.premiumMinor)).toBe('1000.10')
  })

  it('uses annual prices for annual policies', () => {
    const r = computePremium({ vehicleTypes: types, selectedIds: ['trailer'], policyType: 'annual' })
    expect(r).toMatchObject({ ok: true, premium: 4500 })
  })

  it('rejects a type without a price for the policy type', () => {
    const r = computePremium({ vehicleTypes: types, selectedIds: ['light'], policyType: 'annual' })
    expect(r).toEqual({ ok: false, error: 'No annual price configured for Light' })
  })

  it('rejects inactive, unknown and other-insurer types', () => {
    for (const id of ['off', 'nope', 'b-only']) {
      const r = computePremium({ vehicleTypes: types, selectedIds: [id], policyType: 'monthly', insurerId: 'ins-a' })
      expect(r.ok, id).toBe(false)
    }
    const own = computePremium({ vehicleTypes: types, selectedIds: ['b-only'], policyType: 'monthly', insurerId: 'ins-b' })
    expect(own.ok).toBe(true)
  })

  it('rejects an empty selection', () => {
    expect(computePremium({ vehicleTypes: types, selectedIds: [], policyType: 'monthly' }).ok).toBe(false)
  })
})

describe('money', () => {
  it('converts to and from minor units', () => {
    expect(toMinor('3000.00')).toBe(300000)
    expect(toMinor(0.1 + 0.2)).toBe(30)
    expect(formatMinor(5)).toBe('0.05')
  })
})

describe('calculateEndDate', () => {
  it('adds 30 / 365 days like the database', () => {
    expect(calculateEndDate('2026-10-23', 'monthly')).toBe('2026-11-22')
    expect(calculateEndDate('2026-10-23', 'annual')).toBe('2027-10-23')
    expect(calculateEndDate('2028-01-31', 'monthly')).toBe('2028-03-01') // leap year
  })

  it('always prices in MZN', () => {
    const r = computePremium({ vehicleTypes: types, selectedIds: ['light'], policyType: 'monthly' })
    expect(r.ok && r.currency).toBe('MZN')
  })
})

describe('reference amounts', () => {
  const rates = [
    { from_currency: 'ZAR', to_currency: 'MZN', rate: 3.4 },
    { from_currency: 'USD', to_currency: 'MZN', rate: '63.5' },
    { from_currency: 'MZN', to_currency: 'ZAR', rate: 0.29 },
  ]
  it('converts MZN to rand and dollars, rounding up to the cent', () => {
    expect(referenceAmounts(170_000, rates)).toEqual([
      { currency: 'ZAR', amount: 500 },
      { currency: 'USD', amount: 26.78 },
    ])
  })
  it('skips currencies without a rate', () => {
    expect(referenceAmounts(170_000, rates.slice(0, 1))).toEqual([{ currency: 'ZAR', amount: 500 }])
  })
})

describe('insurer settings', () => {
  it('reads MZN amounts saved in the old per-currency shape', () => {
    const s = parseInsurerSettings({ exposure_cap_value: { MZN: 40000, ZAR: 15000, USD: 800 }, offline_credit_allowance: 5000 })
    expect(s.exposure_cap_value).toBe(40000)
    expect(s.offline_credit_allowance).toBe(5000)
  })
})
