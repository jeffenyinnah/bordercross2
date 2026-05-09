'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { ActionResult, Currency } from '@/lib/types'

export async function topUpWallet(
  agentId: string,
  currency: Currency,
  amount: number,
  description?: string
): Promise<ActionResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const { data: wallet, error: walletError } = await supabase
    .from('credit_wallets')
    .select('*')
    .eq('agent_id', agentId)
    .single()

  if (walletError) return { success: false, error: walletError.message }

  const balanceField = `balance_${currency.toLowerCase()}` as
    | 'balance_mzn'
    | 'balance_zar'
    | 'balance_usd'
  const newBalance = (wallet[balanceField] as number) + amount

  const { error: updateError } = await supabase
    .from('credit_wallets')
    .update({ [balanceField]: newBalance, updated_at: new Date().toISOString() })
    .eq('agent_id', agentId)

  if (updateError) return { success: false, error: updateError.message }

  await supabase.from('credit_transactions').insert({
    wallet_id: wallet.id,
    agent_id: agentId,
    type: 'credit',
    currency,
    amount,
    balance_after: newBalance,
    description: description || `Top-up by admin`,
    performed_by: user.id,
  })

  revalidatePath(`/agents/${agentId}`)
  revalidatePath('/reports/transactions')
  return { success: true }
}
