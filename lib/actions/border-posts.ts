'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { ActionResult } from '@/lib/types'

export async function upsertBorderPost(data: {
  id?: string
  name: string
  code: string
  province?: string | null
}): Promise<ActionResult> {
  const supabase = await createClient()
  const payload = { name: data.name, code: data.code.toUpperCase(), province: data.province || null }

  if (data.id) {
    const { error } = await supabase.from('border_posts').update(payload).eq('id', data.id)
    if (error) return { success: false, error: error.message }
  } else {
    const { error } = await supabase.from('border_posts').insert(payload)
    if (error) return { success: false, error: error.message }
  }

  revalidatePath('/settings/border-posts')
  return { success: true }
}

export async function toggleBorderPostStatus(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { data: post } = await supabase.from('border_posts').select('is_active').eq('id', id).single()
  if (!post) return { success: false, error: 'Not found' }

  const { error } = await supabase.from('border_posts').update({ is_active: !post.is_active }).eq('id', id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/settings/border-posts')
  return { success: true }
}

export async function deleteBorderPost(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('border_posts').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath('/settings/border-posts')
  return { success: true }
}
