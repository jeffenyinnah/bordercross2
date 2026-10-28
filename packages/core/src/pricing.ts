import { formatMinor, PRICE_CURRENCY, toMinor, type Minor, type PriceCurrency } from './money'

export type PolicyType = 'monthly' | 'annual'

export interface PricedVehicleType {
  id: string
  name: string
  is_active: boolean
  insurer_id?: string | null
  price_mzn: number | null
  price_mzn_annual: number | null
}

export interface PremiumLine {
  id: string
  name: string
  price: number
}

export type PremiumResult =
  | {
      ok: true
      premium: number
      premiumMinor: Minor
      currency: PriceCurrency
      lines: PremiumLine[]
      /** "Coverage: A + B" when more than one type is selected (same as the DB RPC) */
      coverageNote: string | null
    }
  | { ok: false; error: string }

export function priceFor(vt: PricedVehicleType, policyType: PolicyType): number | null {
  return policyType === 'annual' ? vt.price_mzn_annual : vt.price_mzn
}

/**
 * Mirrors public.create_policy_with_debit: distinct, active types visible to the
 * insurer (global or the insurer's own), every one priced, total > 0.
 * The server recomputes this; the device uses it to show the amount to charge.
 */
export function computePremium(input: {
  vehicleTypes: PricedVehicleType[]
  selectedIds: string[]
  policyType: PolicyType
  insurerId?: string | null
}): PremiumResult {
  const ids = [...new Set(input.selectedIds)]
  if (ids.length === 0) return { ok: false, error: 'Select at least one vehicle type' }

  const lines: PremiumLine[] = []
  let total: Minor = 0
  for (const id of ids) {
    const vt = input.vehicleTypes.find((v) => v.id === id)
    const visible = vt && vt.is_active
      && (vt.insurer_id == null || vt.insurer_id === input.insurerId)
    if (!vt || !visible) {
      return { ok: false, error: 'One or more vehicle types are invalid or inactive' }
    }
    const price = priceFor(vt, input.policyType)
    if (price == null) {
      return {
        ok: false,
        error: `No ${input.policyType} price configured for ${vt.name}`,
      }
    }
    total += toMinor(price)
    lines.push({ id: vt.id, name: vt.name, price })
  }

  if (total <= 0) return { ok: false, error: 'Premium must be greater than zero' }

  const names = lines.map((l) => l.name).sort()
  return {
    ok: true,
    premium: Number(formatMinor(total)),
    premiumMinor: total,
    currency: PRICE_CURRENCY,
    lines,
    coverageNote: lines.length > 1 ? `Coverage: ${names.join(' + ')}` : null,
  }
}

/** End date as the DB computes it: start + 30 days (monthly) or + 365 days (annual). */
export function calculateEndDate(startDate: string, policyType: PolicyType): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate)
  if (!m) throw new Error(`Invalid start date: ${startDate}`)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() + (policyType === 'annual' ? 365 : 30))
  return d.toISOString().slice(0, 10)
}

export interface ExchangeRateRow { from_currency: string; to_currency: string; rate: number | string }

/**
 * What an MZN amount is worth in rand and dollars at the admin-set rates, for a
 * driver paying cash. Display only: the policy, wallet and accounting stay in MZN.
 * A currency without a positive X->MZN rate is left out.
 */
export function referenceAmounts(amountMinor: Minor, rates: ExchangeRateRow[]): { currency: 'ZAR' | 'USD'; amount: number }[] {
  return (['ZAR', 'USD'] as const).flatMap((currency) => {
    const rate = Number(rates.find((r) => r.from_currency === currency && r.to_currency === PRICE_CURRENCY)?.rate)
    return rate > 0 ? [{ currency, amount: Math.ceil(amountMinor / rate) / 100 }] : []
  })
}
