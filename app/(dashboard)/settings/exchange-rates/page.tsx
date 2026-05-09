import { createClient } from '@/lib/supabase/server'
import { ExchangeRatesManager } from '@/components/settings/ExchangeRatesManager'

export default async function ExchangeRatesPage() {
  const supabase = await createClient()
  const { data: rates } = await supabase
    .from('exchange_rates')
    .select('*')
    .order('from_currency')

  return <ExchangeRatesManager rates={rates ?? []} />
}
