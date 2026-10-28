import 'server-only'

import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile, UserRole } from '@/lib/types'

// Deduplicated per request: layout + page + actions share one auth/profile lookup
export const getCurrentUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const user = await getCurrentUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  return data
})

type AuthResult =
  | { ok: true; profile: Profile }
  | { ok: false; error: string }

export async function requireActiveUser(): Promise<AuthResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { ok: false, error: 'Not authenticated' }
  if (!profile.is_active) return { ok: false, error: 'Account is inactive' }
  return { ok: true, profile }
}

export async function requireAdmin(): Promise<AuthResult> {
  const result = await requireActiveUser()
  if (!result.ok) return result
  if (result.profile.role !== 'admin') return { ok: false, error: 'Forbidden' }
  return result
}

/** Back-office roles. Agents use the phone app at /agent. */
export const STAFF_ROLES = ['admin', 'insurer_admin', 'finance'] as const satisfies readonly UserRole[]

/**
 * Insurers run their own business: only their admins change agents, wallets,
 * prices, terminals and policies. The platform admin sees everything read-only.
 */
export const INSURER_MANAGERS = ['insurer_admin'] as const satisfies readonly UserRole[]

/** Insurer staff who decide on card payments */
export const PAYMENT_REVIEWERS = ['insurer_admin', 'finance'] as const satisfies readonly UserRole[]

export async function requireRole(roles: readonly UserRole[]): Promise<AuthResult> {
  const result = await requireActiveUser()
  if (!result.ok) return result
  if (!roles.includes(result.profile.role)) return { ok: false, error: 'Forbidden' }
  return result
}

/** For server pages: the signed-in profile, or a redirect when the role may not see the page. */
export async function requirePageRole(roles: readonly UserRole[]): Promise<Profile> {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!profile.is_active || !roles.includes(profile.role)) redirect('/dashboard')
  return profile
}

/**
 * Platform admins act on any insurer; insurer staff only on their own.
 * Returns the insurer to act on, or null when the caller may not.
 */
export function actingInsurer(profile: Profile, insurerId?: string | null): string | null {
  if (profile.role === 'admin') return insurerId ?? null
  if (!profile.insurer_id) return null
  return !insurerId || insurerId === profile.insurer_id ? profile.insurer_id : null
}
