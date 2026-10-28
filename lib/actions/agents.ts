'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { INSURER_MANAGERS, requireRole } from '@/lib/auth'
import { createAccount } from '@/lib/accounts'
import type { ActionResult } from '@/lib/types'

const createAgentSchema = z.object({
  full_name: z.string().trim().min(1, 'Name is required'),
  email: z.email().trim(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  border_post_id: z.uuid().nullable().optional(),
  parent_agent_id: z.uuid().nullable().optional(),
  commission_rate: z.number().min(0).max(100),
  sub_agent_override_rate: z.number().min(0).max(100),
})

export async function createAgent(
  data: z.input<typeof createAgentSchema>
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireRole(INSURER_MANAGERS)
  if (!auth.ok) return { success: false, error: auth.error }

  const parsed = createAgentSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const input = parsed.data

  // agents always join the creating admin's own insurer
  const insurerId = auth.profile.insurer_id
  if (!insurerId) return { success: false, error: 'Your login is not linked to an insurer' }
  if (input.parent_agent_id) {
    const supabase = await createClient()
    const { data: parent } = await supabase
      .from('profiles').select('insurer_id').eq('id', input.parent_agent_id).eq('role', 'agent').single()
    if (!parent || parent.insurer_id !== insurerId) return { success: false, error: 'Parent agent not found' }
  }

  const result = await createAccount({ ...input, role: 'agent', insurer_id: insurerId })
  if (!result.ok) return { success: false, error: result.error }

  revalidatePath('/agents')
  return { success: true, data: { id: result.id } }
}

const updateAgentSchema = z.object({
  full_name: z.string().trim().min(1).optional(),
  commission_rate: z.number().min(0).max(100).optional(),
  sub_agent_override_rate: z.number().min(0).max(100).optional(),
  parent_agent_id: z.uuid().nullable().optional(),
  border_post_id: z.uuid().nullable().optional(),
})

// Row-level security limits insurer admins to their own insurer's agents and the
// profile guard trigger to the fields above.
export async function updateAgent(
  id: string,
  data: z.input<typeof updateAgentSchema>
): Promise<ActionResult> {
  const auth = await requireRole(INSURER_MANAGERS)
  if (!auth.ok) return { success: false, error: auth.error }

  const parsed = updateAgentSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  if (parsed.data.parent_agent_id === id) {
    return { success: false, error: 'An agent cannot be their own parent' }
  }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from('profiles')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('role', 'agent')
    .select('id')

  if (error) return { success: false, error: error.message }
  if (!updated?.length) return { success: false, error: 'Agent not found' }
  revalidatePath('/agents')
  revalidatePath(`/agents/${id}`)
  return { success: true }
}

export async function toggleAgentStatus(id: string): Promise<ActionResult> {
  const auth = await requireRole(INSURER_MANAGERS)
  if (!auth.ok) return { success: false, error: auth.error }

  const supabase = await createClient()
  const { data: profile, error: fetchError } = await supabase
    .from('profiles')
    .select('is_active')
    .eq('id', id)
    .eq('role', 'agent')
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

/**
 * Block a lost or replaced phone: it can no longer sync, lease numbers or credit.
 * Offline sales already made on it still need to reach the server from that phone.
 */
export async function revokeDevice(deviceId: string, agentId: string): Promise<ActionResult> {
  const auth = await requireRole(INSURER_MANAGERS)
  if (!auth.ok) return { success: false, error: auth.error }

  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from('devices')
    .update({ revoked_at: new Date().toISOString(), revoked_by: auth.profile.id })
    .eq('id', deviceId)
    .is('revoked_at', null)
    .select('id')

  if (error) return { success: false, error: error.message }
  if (!updated?.length) return { success: false, error: 'Device not found or already blocked' }
  revalidatePath(`/agents/${agentId}`)
  return { success: true }
}
