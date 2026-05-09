'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ActionResult } from '@/lib/types'

export async function createAgent(data: {
  full_name: string
  email: string
  password: string
  role: 'agent'
  parent_agent_id?: string | null
  commission_rate: number
  sub_agent_override_rate: number
}): Promise<ActionResult<{ id: string }>> {
  const adminClient = createAdminClient()

  const { data: authUser, error: authError } =
    await adminClient.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    })

  if (authError) return { success: false, error: authError.message }

  const { error: profileError } = await adminClient.from('profiles').insert({
    id: authUser.user.id,
    full_name: data.full_name,
    email: data.email,
    role: data.role,
    parent_agent_id: data.parent_agent_id || null,
    commission_rate: data.commission_rate,
    sub_agent_override_rate: data.sub_agent_override_rate,
  })

  if (profileError) {
    await adminClient.auth.admin.deleteUser(authUser.user.id)
    return { success: false, error: profileError.message }
  }

  await adminClient.from('credit_wallets').insert({
    agent_id: authUser.user.id,
    balance_mzn: 0,
    balance_zar: 0,
    balance_usd: 0,
  })

  revalidatePath('/agents')
  return { success: true, data: { id: authUser.user.id } }
}

export async function updateAgent(
  id: string,
  data: {
    full_name?: string
    commission_rate?: number
    sub_agent_override_rate?: number
    parent_agent_id?: string | null
  }
): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('profiles')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/agents')
  revalidatePath(`/agents/${id}`)
  return { success: true }
}

export async function toggleAgentStatus(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: profile, error: fetchError } = await supabase
    .from('profiles')
    .select('is_active')
    .eq('id', id)
    .single()

  if (fetchError) return { success: false, error: fetchError.message }

  const { error } = await supabase
    .from('profiles')
    .update({ is_active: !profile.is_active })
    .eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/agents')
  revalidatePath(`/agents/${id}`)
  return { success: true }
}
