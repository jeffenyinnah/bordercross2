import type { Currency } from '@/lib/types'

const formatters: Record<Currency, Intl.NumberFormat> = {
  MZN: new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN' }),
  ZAR: new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }),
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
}

export function formatCurrency(amount: number, currency: Currency): string {
  return formatters[currency].format(amount)
}

export function getCurrencySymbol(currency: Currency): string {
  const symbols: Record<Currency, string> = { MZN: 'MT', ZAR: 'R', USD: '$' }
  return symbols[currency]
}
