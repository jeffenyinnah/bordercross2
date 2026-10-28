import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { UserRole } from '@/lib/types'

/**
 * Create a login and its profile (and, for agents, an empty MZN wallet).
 * Needs the service role; callers authorise first. A failed step removes the
 * auth user again (cascading to the profile) so nothing is left half-created.
 */
export async function createAccount(input: {
  email: string
  password: string
  full_name: string
  role: UserRole
  insurer_id: string
  border_post_id?: string | null
  parent_agent_id?: string | null
  commission_rate?: number
  sub_agent_override_rate?: number
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const admin = createAdminClient()
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  })
  if (authError) return { ok: false, error: authError.message }
  const id = created.user.id

  const { error: profileError } = await admin.from('profiles').insert({
    id,
    full_name: input.full_name,
    email: input.email,
    role: input.role,
    insurer_id: input.insurer_id,
    border_post_id: input.border_post_id ?? null,
    parent_agent_id: input.parent_agent_id ?? null,
    ...(input.commission_rate !== undefined && { commission_rate: input.commission_rate }),
    ...(input.sub_agent_override_rate !== undefined && { sub_agent_override_rate: input.sub_agent_override_rate }),
  })
  const { error: walletError } = profileError || input.role !== 'agent'
    ? { error: null }
    : await admin.from('credit_wallets').insert({ agent_id: id, balance_mzn: 0 })

  if (profileError || walletError) {
    await admin.auth.admin.deleteUser(id)
    return { ok: false, error: (profileError ?? walletError)!.message }
  }
  return { ok: true, id }
}
