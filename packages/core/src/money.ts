/**
 * Currencies a card slip can print. Everything BORDERCROSS sells (prices, premiums,
 * wallets, commissions) is in meticais; a slip in another currency is a mismatch.
 */
export const CURRENCIES = ['MZN', 'ZAR', 'USD'] as const
export type Currency = (typeof CURRENCIES)[number]

/** The only currency policies are priced and paid in. */
export const PRICE_CURRENCY = 'MZN' as const
export type PriceCurrency = typeof PRICE_CURRENCY

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value)
}

/** Amount in minor units (cents). All money arithmetic happens on integers. */
export type Minor = number

export function toMinor(amount: number | string): Minor {
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${amount}`)
  return Math.round(n * 100)
}

export function fromMinor(minor: Minor): number {
  return minor / 100
}

/** "3000.00" — the canonical string form used for slip amounts and comparisons. */
export function formatMinor(minor: Minor): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * Parse a printed/typed decimal: 3000.00 | 3,000.00 | 3.000,00 | 3000,00 | 3 000,00 | 3000.
 * The last separator followed by exactly two digits is the decimal point.
 * Returns minor units, or null when the text is not a plain number.
 */
export function parseDecimal(text: string): Minor | null {
  const cleaned = text.replace(/[\s']/g, '')
  if (!/^[0-9.,]+$/.test(cleaned)) return null
  const m = /^(.*?)(?:[.,](\d{2}))?$/.exec(cleaned)!
  const intPart = m[1].replace(/[.,]/g, '')
  if (!/^\d+$/.test(intPart) || intPart.length > 9) return null
  return Number(intPart) * 100 + Number(m[2] ?? '0')
}
