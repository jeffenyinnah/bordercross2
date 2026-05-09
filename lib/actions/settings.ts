'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { ActionResult } from '@/lib/types'

export async function upsertVehicleType(data: {
  id?: string
  name: string
  description?: string | null
  price_mzn: number
  price_zar: number
  price_usd: number
  price_mzn_annual?: number | null
  price_zar_annual?: number | null
  price_usd_annual?: number | null
}): Promise<ActionResult> {
  const supabase = await createClient()

  if (data.id) {
    const { error } = await supabase
      .from('vehicle_types')
      .update(data)
      .eq('id', data.id)
    if (error) return { success: false, error: error.message }
  } else {
    const { error } = await supabase.from('vehicle_types').insert(data)
    if (error) return { success: false, error: error.message }
  }

  revalidatePath('/settings/vehicle-types')
  return { success: true }
}

export async function deleteVehicleType(id: string): Promise<ActionResult> {
  const supabase = await createClient()

  const { count } = await supabase
    .from('policies')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_type_id', id)

  if (count && count > 0) {
    const { error } = await supabase
      .from('vehicle_types')
      .update({ is_active: false })
      .eq('id', id)
    if (error) return { success: false, error: error.message }
  } else {
    const { error } = await supabase
      .from('vehicle_types')
      .delete()
      .eq('id', id)
    if (error) return { success: false, error: error.message }
  }

  revalidatePath('/settings/vehicle-types')
  return { success: true }
}

export async function updateExchangeRate(
  from: string,
  to: string,
  rate: number
): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { error } = await supabase
    .from('exchange_rates')
    .update({ rate, updated_by: user?.id, updated_at: new Date().toISOString() })
    .eq('from_currency', from)
    .eq('to_currency', to)

  if (error) return { success: false, error: error.message }
  revalidatePath('/settings/exchange-rates')
  return { success: true }
}

export async function updateCommissionDefaults(
  agentId: string,
  rate: number,
  overrideRate: number
): Promise<ActionResult> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('profiles')
    .update({ commission_rate: rate, sub_agent_override_rate: overrideRate })
    .eq('id', agentId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/settings/commissions')
  return { success: true }
}
