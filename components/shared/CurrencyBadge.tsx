import { Badge } from '@/components/ui/badge'
import type { Currency } from '@/lib/types'

const styles: Record<Currency, string> = {
  MZN: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
  ZAR: 'bg-green-100 text-green-800 hover:bg-green-100',
  USD: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
}

export function CurrencyBadge({ currency }: { currency: Currency }) {
  return <Badge className={styles[currency]}>{currency}</Badge>
}
