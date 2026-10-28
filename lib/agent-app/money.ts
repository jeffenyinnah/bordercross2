import { formatMinor, referenceAmounts, type ExchangeRateRow } from '@bordercross/core'

export const money = (minor: number, currency = 'MZN') =>
  `${Number(formatMinor(minor)).toLocaleString('en-US', { minimumFractionDigits: 2 })} ${currency}`

/** "≈ 500.00 ZAR · 26.78 USD" for a driver paying cash; empty without rates. */
export function referenceText(minor: number, rates: ExchangeRateRow[]): string {
  const refs = referenceAmounts(minor, rates)
  return refs.length ? `≈ ${refs.map((r) => money(Math.round(r.amount * 100), r.currency)).join(' · ')}` : ''
}
