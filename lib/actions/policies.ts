'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ActionResult } from '@/lib/types'

export interface CreatePolicyInput {
  policy_type: 'monthly' | 'annual'
  currency: 'MZN' | 'ZAR' | 'USD'
  vehicle_type_ids: string[]
  vehicle_type_names?: string[]
  premium_amounts: Record<string, number>
  client_name: string
  client_id_number?: string
  client_nationality?: string
  plate_number: string
  vehicle_brand: string
  vehicle_model: string
  vehicle_year?: number
  engine_number?: string
  chassis_number?: string
  start_date: string
  border?: string
  document_type?: string
  document_url?: string
  notes?: string
}

export async function createPolicy(
  input: CreatePolicyInput
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  if (input.vehicle_type_ids.length === 0) {
    return { success: false, error: 'Select at least one vehicle type' }
  }

  // One policy regardless of how many vehicle types are selected.
  // Use the first type as the primary vehicle_type_id; sum all premiums.
  const primaryVehicleTypeId = input.vehicle_type_ids[0]
  const totalPremium = input.vehicle_type_ids.reduce(
    (sum, id) => sum + (input.premium_amounts[id] ?? 0),
    0
  )

  // Record combined coverage in notes when multiple types are selected
  let finalNotes = input.notes || null
  const typeNames = input.vehicle_type_names ?? []
  if (typeNames.length > 1) {
    const coverageNote = `Coverage: ${typeNames.join(' + ')}`
    finalNotes = finalNotes ? `${finalNotes} | ${coverageNote}` : coverageNote
  }

  const { data, error } = await supabase.rpc('create_policy_with_debit', {
    p_agent_id: user.id,
    p_client_name: input.client_name,
    p_vehicle_type_id: primaryVehicleTypeId,
    p_policy_type: input.policy_type,
    p_currency: input.currency,
    p_premium_amount: totalPremium,
    p_plate: input.plate_number.toUpperCase(),
    p_brand: input.vehicle_brand,
    p_model: input.vehicle_model,
    p_year: input.vehicle_year || null,
    p_engine: input.engine_number || null,
    p_chassis: input.chassis_number || null,
    p_start_date: input.start_date,
    p_client_id: input.client_id_number || null,
    p_nationality: input.client_nationality || null,
    p_notes: finalNotes,
    p_border: input.border || null,
    p_document_type: input.document_type || null,
    p_document_url: input.document_url || null,
  })

  if (error) return { success: false, error: error.message }

  revalidatePath('/policies')
  revalidatePath('/dashboard')
  redirect(`/policies/${data}`)
}

export async function updatePolicy(
  id: string,
  data: {
    client_name?: string
    client_id_number?: string | null
    client_nationality?: string | null
    plate_number?: string
    vehicle_brand?: string
    vehicle_model?: string
    vehicle_year?: number | null
    engine_number?: string | null
    chassis_number?: string | null
    border?: string | null
    notes?: string | null
    document_type?: string | null
  }
): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return { success: false, error: 'Only admins can edit policies' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('policies')
    .update({
      ...data,
      ...(data.plate_number && { plate_number: data.plate_number.toUpperCase() }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/policies')
  revalidatePath(`/policies/${id}`)
  return { success: true }
}

export async function cancelPolicy(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    return { success: false, error: 'Only admins can cancel policies' }
  }

  const { error } = await supabase
    .from('policies')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/policies')
  revalidatePath(`/policies/${id}`)
  return { success: true }
}
