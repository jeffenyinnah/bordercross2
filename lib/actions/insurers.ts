'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { insurerSettingsSchema, PAYMENT_METHODS } from '@bordercross/core'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { INSURER_MANAGERS, actingInsurer, requireAdmin, requireRole } from '@/lib/auth'
import { createAccount } from '@/lib/accounts'
import type { ActionResult } from '@/lib/types'

const insurerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, 'Code: 2-20 letters, digits or _'),
  /** the insurer's first admin login; they set up everything else themselves */
  admin: z.object({
    full_name: z.string().trim().min(1, 'Admin name is required'),
    email: z.email('Admin email is invalid').trim(),
    password: z.string().min(8, 'Admin password must be at least 8 characters'),
  }),
})

/**
 * Onboard an insurer: the insurer, a copy of the default price list (database
 * trigger) and its first insurer admin. Nothing is kept when the login fails.
 */
export async function createInsurer(data: z.input<typeof insurerSchema>): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAdmin()
  if (!auth.ok) return { success: false, error: auth.error }
  const parsed = insurerSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { admin: firstAdmin, ...insurer } = parsed.data

  const supabase = await createClient()
  const { data: row, error } = await supabase.from('insurers').insert(insurer).select('id').single()
  if (error) {
    return { success: false, error: error.code === '23505' ? 'An insurer with this code already exists' : error.message }
  }

  const account = await createAccount({ ...firstAdmin, role: 'insurer_admin', insurer_id: row.id })
  if (!account.ok) {
    const service = createAdminClient()
    await service.from('vehicle_types').delete().eq('insurer_id', row.id)
    await service.from('insurers').delete().eq('id', row.id)
    return { success: false, error: `Admin login: ${account.error}` }
  }

  revalidatePath('/insurers')
  return { success: true, data: { id: row.id } }
}

export async function updateInsurer(
  id: string, data: { name?: string; is_active?: boolean }
): Promise<ActionResult> {
  const auth = await requireAdmin()
  if (!auth.ok) return { success: false, error: auth.error }
  const name = data.name?.trim()
  if (name !== undefined && name.length < 2) return { success: false, error: 'Name is required' }

  const supabase = await createClient()
  const { error } = await supabase.from('insurers')
    .update({ ...(name !== undefined && { name }), ...(data.is_active !== undefined && { is_active: data.is_active }) })
    .eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/insurers')
  revalidatePath(`/insurers/${id}`)
  return { success: true }
}

/**
 * Payment methods and thresholds. The values are checked with the same schema
 * the phones use, so a saved setting can never break the app. Phones pick the
 * change up on their next refresh.
 */
export async function updateInsurerSettings(
  id: string,
  data: { payment_methods: string[]; settings: Record<string, unknown> }
): Promise<ActionResult> {
  const auth = await requireRole(INSURER_MANAGERS)
  if (!auth.ok) return { success: false, error: auth.error }
  if (auth.profile.insurer_id !== id) return { success: false, error: 'Forbidden' }

  const methods = z.array(z.enum(PAYMENT_METHODS)).min(1, 'Enable at least one payment method')
    .safeParse([...new Set(data.payment_methods)])
  if (!methods.success) return { success: false, error: methods.error.issues[0].message }

  const supabase = await createClient()
  const { data: current, error: readError } = await supabase.from('insurers').select('settings').eq('id', id).single()
  if (readError) return { success: false, error: readError.message }

  const settings = insurerSettingsSchema.safeParse({ ...(current.settings as object), ...data.settings })
  if (!settings.success) {
    const issue = settings.error.issues[0]
    return { success: false, error: `${issue.path.join('.') || 'settings'}: ${issue.message}` }
  }

  const { error } = await supabase.from('insurers')
    .update({ payment_methods: methods.data, settings: settings.data })
    .eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath(`/insurers/${id}`)
  return { success: true }
}

const staffSchema = z.object({
  full_name: z.string().trim().min(1, 'Name is required'),
  email: z.email().trim(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['insurer_admin', 'finance']),
})

/** Back-office logins of an insurer. Insurer admins add staff to their own insurer. */
export async function createStaff(
  insurerId: string, data: z.input<typeof staffSchema>
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireRole(['admin', 'insurer_admin'])
  if (!auth.ok) return { success: false, error: auth.error }
  const insurer = actingInsurer(auth.profile, insurerId)
  if (!insurer) return { success: false, error: 'Forbidden' }

  const parsed = staffSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const result = await createAccount({ ...parsed.data, insurer_id: insurer })
  if (!result.ok) return { success: false, error: result.error }
  revalidatePath(`/insurers/${insurer}`)
  return { success: true, data: { id: result.id } }
}

export async function toggleStaffStatus(staffId: string): Promise<ActionResult> {
  const auth = await requireRole(['admin', 'insurer_admin'])
  if (!auth.ok) return { success: false, error: auth.error }
  if (staffId === auth.profile.id) return { success: false, error: 'You cannot deactivate yourself' }

  // Staff rows are protected by the profile guard; the authorisation is checked
  // here and the write uses the service role.
  const admin = createAdminClient()
  const { data: staff } = await admin.from('profiles')
    .select('id, role, insurer_id, is_active').eq('id', staffId).single()
  if (!staff || !['insurer_admin', 'finance'].includes(staff.role)) {
    return { success: false, error: 'Staff member not found' }
  }
  if (!actingInsurer(auth.profile, staff.insurer_id)) return { success: false, error: 'Forbidden' }

  const { error } = await admin.from('profiles')
    .update({ is_active: !staff.is_active, updated_at: new Date().toISOString() })
    .eq('id', staffId)
  if (error) return { success: false, error: error.message }
  revalidatePath(`/insurers/${staff.insurer_id}`)
  return { success: true }
}
