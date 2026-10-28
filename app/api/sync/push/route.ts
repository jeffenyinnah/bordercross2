import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { PushForbidden, pushItem } from '@/lib/sync/push'

const bodySchema = z.object({
  device_id: z.uuid(),
  kind: z.enum(['policy', 'card_payment']),
  record: z.unknown(),
  image: z.string().max(8_000_000).nullable().optional(),
})

/**
 * The agent app pushes its outbox here one item at a time, in order. Every
 * answer with status 200 means the server has the item (stored, already
 * there, or kept as a rejection), so the phone may remove it from its outbox.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: body.error.issues[0].message }, { status: 400 })

  try {
    return NextResponse.json(await pushItem(supabase, user.id, body.data))
  } catch (e) {
    if (e instanceof PushForbidden) return NextResponse.json({ error: e.message }, { status: 403 })
    console.error('[sync/push]', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
