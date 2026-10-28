'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { INSURER_MANAGERS, actingInsurer, requireRole } from '@/lib/auth'
import type { ActionResult } from '@/lib/types'

// Merchant accounts (MID) and POS terminals (TID) form the whitelist the phones
// check every card slip against. Row-level security limits insurer admins to
// their own insurer; these actions add friendlier errors on top.

const MANAGERS = INSURER_MANAGERS

function friendly(error: { code?: string; message: string }, what: string) {
  if (error.code === '23505') return `This ${what} is already registered`
  if (error.code === '23503') return 'The merchant account (MID) is not registered for this insurer'
  return error.message
}

const merchantSchema = z.object({
  insurer_id: z.uuid(),
  mid: z.string().trim().regex(/^[0-9]{15}$/, 'MID is 15 digits, as printed on the slip'),
  bank: z.string().trim().min(2, 'Bank is required'),
  name: z.string().trim().optional(),
})

export async function createMerchant(data: z.input<typeof merchantSchema>): Promise<ActionResult> {
  const auth = await requireRole(MANAGERS)
  if (!auth.ok) return { success: false, error: auth.error }
  const parsed = merchantSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const insurerId = actingInsurer(auth.profile, parsed.data.insurer_id)
  if (!insurerId) return { success: false, error: 'Forbidden' }

  const supabase = await createClient()
  const { error } = await supabase.from('merchant_accounts')
    .insert({ ...parsed.data, insurer_id: insurerId, name: parsed.data.name || null })
  if (error) return { success: false, error: friendly(error, 'MID') }
  revalidatePath('/terminals')
  return { success: true }
}

/** The MID itself never changes: terminals and past slips refer to it. */
export async function updateMerchant(
  id: string, data: { bank?: string; name?: string | null; is_active?: boolean }
): Promise<ActionResult> {
  const auth = await requireRole(MANAGERS)
  if (!auth.ok) return { success: false, error: auth.error }

  const supabase = await createClient()
  const { data: updated, error } = await supabase.from('merchant_accounts')
    .update({
      ...(data.bank !== undefined && { bank: data.bank.trim() }),
      ...(data.name !== undefined && { name: data.name?.trim() || null }),
      ...(data.is_active !== undefined && { is_active: data.is_active }),
    })
    .eq('id', id).select('id')
  if (error) return { success: false, error: error.message }
  if (!updated?.length) return { success: false, error: 'Merchant account not found' }
  revalidatePath('/terminals')
  return { success: true }
}

const terminalSchema = z.object({
  insurer_id: z.uuid(),
  tid: z.string().trim().regex(/^[0-9]{8}$/, 'TID is 8 digits, as printed on the slip'),
  mid: z.string().trim().regex(/^[0-9]{15}$/, 'Choose the merchant account (MID)'),
  bank: z.string().trim().min(2, 'Bank is required'),
  assigned_agent_id: z.uuid().nullable(),
  border_post_id: z.uuid().nullable(),
})

async function checkAssignment(
  supabase: Awaited<ReturnType<typeof createClient>>, insurerId: string, agentId: string | null
) {
  if (!agentId) return null
  const { data } = await supabase.from('profiles').select('insurer_id')
    .eq('id', agentId).eq('role', 'agent').single()
  return data?.insurer_id === insurerId ? null : 'The assigned agent must work for the same insurer'
}

export async function createTerminal(data: z.input<typeof terminalSchema>): Promise<ActionResult> {
  const auth = await requireRole(MANAGERS)
  if (!auth.ok) return { success: false, error: auth.error }
  const parsed = terminalSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const insurerId = actingInsurer(auth.profile, parsed.data.insurer_id)
  if (!insurerId) return { success: false, error: 'Forbidden' }

  const supabase = await createClient()
  const bad = await checkAssignment(supabase, insurerId, parsed.data.assigned_agent_id)
  if (bad) return { success: false, error: bad }
  const { error } = await supabase.from('terminals').insert({ ...parsed.data, insurer_id: insurerId })
  if (error) return { success: false, error: friendly(error, 'TID') }
  revalidatePath('/terminals')
  return { success: true }
}

/** TID and MID are the terminal's identity; reassignments and bank changes are edits. */
export async function updateTerminal(
  id: string,
  data: { bank?: string; assigned_agent_id?: string | null; border_post_id?: string | null; is_active?: boolean }
): Promise<ActionResult> {
  const auth = await requireRole(MANAGERS)
  if (!auth.ok) return { success: false, error: auth.error }

  const supabase = await createClient()
  const { data: terminal } = await supabase.from('terminals').select('insurer_id').eq('id', id).single()
  if (!terminal) return { success: false, error: 'Terminal not found' }
  if (data.assigned_agent_id !== undefined) {
    const bad = await checkAssignment(supabase, terminal.insurer_id, data.assigned_agent_id)
    if (bad) return { success: false, error: bad }
  }

  const { error } = await supabase.from('terminals')
    .update({
      ...(data.bank !== undefined && { bank: data.bank.trim() }),
      ...(data.assigned_agent_id !== undefined && { assigned_agent_id: data.assigned_agent_id }),
      ...(data.border_post_id !== undefined && { border_post_id: data.border_post_id }),
      ...(data.is_active !== undefined && { is_active: data.is_active }),
    })
    .eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/terminals')
  return { success: true }
}
