import { createClient } from '@/lib/supabase/server'
import { CommissionSettingsManager } from '@/components/settings/CommissionSettingsManager'

export default async function CommissionSettingsPage() {
  const supabase = await createClient()
  const { data: agents } = await supabase
    .from('profiles')
    .select('id, full_name, commission_rate, sub_agent_override_rate, role')
    .order('full_name')

  return <CommissionSettingsManager agents={agents ?? []} />
}
