'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { INSURER_MANAGERS, requireRole } from '@/lib/auth'
import type { ActionResult } from '@/lib/types'

/** Add MZN to an agent's wallet. Only the agent's own insurer may (the RPC enforces it too). */
export async function topUpWallet(
  agentId: string,
  amount: number,
  description?: string
): Promise<ActionResult> {
  const auth = await requireRole(INSURER_MANAGERS)
  if (!auth.ok) return { success: false, error: auth.error }
  if (!(amount > 0)) return { success: false, error: 'Amount must be greater than zero' }

  // Balance update and transaction log happen atomically in the RPC
  const supabase = await createClient()
  const { error } = await supabase.rpc('top_up_wallet', {
    p_agent_id: agentId,
    p_currency: 'MZN',
    p_amount: amount,
    p_description: description ?? null,
  })

  if (error) return { success: false, error: error.message }

  revalidatePath(`/agents/${agentId}`)
  revalidatePath('/agents')
  revalidatePath('/reports/transactions')
  return { success: true }
}
