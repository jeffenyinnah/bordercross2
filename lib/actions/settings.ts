'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { INSURER_MANAGERS, requireAdmin, requireRole } from '@/lib/auth'
import type { ActionResult } from '@/lib/types'

type VehicleTypeInput = {
  id?: string
  name: string
  description?: string | null
  /** MZN, 30 days */
  price_mzn: number
  /** MZN, 365 days; null = not sold annually */
  price_mzn_annual?: number | null
}

function vehicleTypeError(data: VehicleTypeInput): string | null {
  if (!data.name.trim()) return 'Name is required'
  if (!(data.price_mzn > 0)) return 'The monthly price must be greater than zero'
  if (data.price_mzn_annual != null && !(data.price_mzn_annual > 0)) {
    return 'The annual price must be greater than zero, or left empty'
  }
  return null
}

const vehicleTypeFields = (data: VehicleTypeInput) => ({
  name: data.name.trim(),
  description: data.description || null,
  price_mzn: data.price_mzn,
  price_mzn_annual: data.price_mzn_annual ?? null,
})

/** The insurer's own categories and prices. Phones pick changes up on their next refresh. */
export async function upsertVehicleType(data: VehicleTypeInput): Promise<ActionResult> {
  const auth = await requireRole(INSURER_MANAGERS)
  if (!auth.ok) return { success: false, error: auth.error }
  const invalid = vehicleTypeError(data)
  if (invalid) return { success: false, error: invalid }

  // row-level security keeps insurer admins to their own insurer's rows
  const supabase = await createClient()
  const { error } = data.id
    ? await supabase.from('vehicle_types').update(vehicleTypeFields(data)).eq('id', data.id)
    : await supabase.from('vehicle_types')
      .insert({ ...vehicleTypeFields(data), insurer_id: auth.profile.insurer_id })
  if (error) return { success: false, error: error.message }

  revalidatePath('/prices')
  return { success: true }
}

export async function deleteVehicleType(id: string): Promise<ActionResult> {
  const auth = await requireRole(INSURER_MANAGERS)
  if (!auth.ok) return { success: false, error: auth.error }

  const supabase = await createClient()

  const { count } = await supabase
    .from('policies')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_type_id', id)

  // a category with policies stays, inactive, so those policies keep their link
  const { error } = count && count > 0
    ? await supabase.from('vehicle_types').update({ is_active: false }).eq('id', id)
    : await supabase.from('vehicle_types').delete().eq('id', id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/prices')
  return { success: true }
}

/** The default list a new insurer starts from. Existing insurers are not changed. */
export async function upsertVehicleTypeTemplate(data: VehicleTypeInput): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return { success: false, error: auth.error }
  const invalid = vehicleTypeError(data)
  if (invalid) return { success: false, error: invalid }

  const supabase = await createClient()
  const { error } = data.id
    ? await supabase.from('vehicle_type_templates').update(vehicleTypeFields(data)).eq('id', data.id)
    : await supabase.from('vehicle_type_templates').insert(vehicleTypeFields(data))
  if (error) return { success: false, error: error.message }

  revalidatePath('/settings/vehicle-types')
  return { success: true }
}

export async function deleteVehicleTypeTemplate(id: string): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return { success: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase.from('vehicle_type_templates').delete().eq('id', id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/settings/vehicle-types')
  return { success: true }
}

/** Reference rates only (1 ZAR or 1 USD in MZN); nothing is priced or charged with them. */
export async function updateExchangeRate(
  from: 'ZAR' | 'USD',
  rate: number
): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return { success: false, error: auth.error }
  if (from !== 'ZAR' && from !== 'USD') return { success: false, error: 'Unknown currency' }

  if (!(rate > 0)) return { success: false, error: 'Rate must be greater than zero' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('exchange_rates')
    .update({ rate, updated_by: auth.profile.id, updated_at: new Date().toISOString() })
    .eq('from_currency', from)
    .eq('to_currency', 'MZN')

  if (error) return { success: false, error: error.message }
  revalidatePath('/settings/exchange-rates')
  return { success: true }
}
