'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { PAYMENT_REVIEWERS, requireRole } from '@/lib/auth'
import type { ActionResult } from '@/lib/types'

/**
 * Approve: the slip is accepted and the payment waits for the bank settlement.
 * Reject: the payment is not accepted and its policy is cancelled (a note is required).
 */
export async function reviewPayment(
  id: string, decision: 'approve' | 'reject', note?: string
): Promise<ActionResult> {
  const auth = await requireRole(PAYMENT_REVIEWERS)
  if (!auth.ok) return { success: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc('review_card_payment', {
    p_payment_id: id,
    p_decision: decision,
    p_note: note?.trim() || null,
  })
  if (error) return { success: false, error: error.message }

  revalidatePath('/payments')
  revalidatePath(`/payments/${id}`)
  revalidatePath('/policies')
  return { success: true }
}

/** Close an item the server could not accept at sync, with what was done about it. */
export async function resolveSyncRejection(id: string, note: string): Promise<ActionResult> {
  const auth = await requireRole(PAYMENT_REVIEWERS)
  if (!auth.ok) return { success: false, error: auth.error }
  if (!note.trim()) return { success: false, error: 'Write what was done about it' }

  const supabase = await createClient()
  const { data, error } = await supabase.from('sync_rejections')
    .update({ resolved_at: new Date().toISOString(), resolved_by: auth.profile.id, resolution_note: note.trim() })
    .eq('id', id).is('resolved_at', null).select('id')
  if (error) return { success: false, error: error.message }
  if (!data?.length) return { success: false, error: 'Already resolved or not found' }
  revalidatePath('/payments')
  return { success: true }
}
