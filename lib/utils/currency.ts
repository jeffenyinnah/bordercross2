const formatters: Record<string, Intl.NumberFormat> = {
  MZN: new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN' }),
  ZAR: new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }),
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
}

/** Amounts are MZN; ZAR and USD appear only as cash reference amounts and on card slips. */
export function formatCurrency(amount: number, currency: string = 'MZN'): string {
  return (formatters[currency] ?? formatters.MZN).format(Number(amount))
}
