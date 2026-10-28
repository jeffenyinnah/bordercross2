'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { INSURER_MANAGERS, requireRole } from '@/lib/auth'
import type { ActionResult } from '@/lib/types'

// Only descriptive fields are editable; premium, currency, number and agent are not
const updatePolicySchema = z.object({
  client_name: z.string().trim().min(1).optional(),
  client_id_number: z.string().nullable().optional(),
  client_nationality: z.string().nullable().optional(),
  plate_number: z.string().trim().min(1).transform((v) => v.toUpperCase()).optional(),
  vehicle_brand: z.string().trim().min(1).optional(),
  vehicle_model: z.string().trim().min(1).optional(),
  vehicle_year: z.number().int().nullable().optional(),
  engine_number: z.string().nullable().optional(),
  chassis_number: z.string().nullable().optional(),
  border: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  document_type: z.string().nullable().optional(),
})

export async function updatePolicy(
  id: string,
  data: z.input<typeof updatePolicySchema>
): Promise<ActionResult> {
  // insurer admins: row-level security limits them to their own insurer's policies
  const auth = await requireRole(INSURER_MANAGERS)
  if (!auth.ok) return { success: false, error: auth.error }

  const parsed = updatePolicySchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { error } = await supabase
    .from('policies')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/policies')
  revalidatePath(`/policies/${id}`)
  return { success: true }
}

export async function cancelPolicy(id: string): Promise<ActionResult> {
  // insurer admins: row-level security limits them to their own insurer's policies
  const auth = await requireRole(INSURER_MANAGERS)
  if (!auth.ok) return { success: false, error: auth.error }

  const supabase = await createClient()
  const { error } = await supabase
    .from('policies')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath('/policies')
  revalidatePath(`/policies/${id}`)
  return { success: true }
}
