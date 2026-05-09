import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NavTabs } from '@/components/shared/NavTabs'

const SETTINGS_TABS = [
  { label: 'Vehicle Types', href: '/settings/vehicle-types' },
  { label: 'Exchange Rates', href: '/settings/exchange-rates' },
  { label: 'Commissions', href: '/settings/commissions' },
  { label: 'Border Posts', href: '/settings/border-posts' },
]

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      <NavTabs tabs={SETTINGS_TABS} />
      {children}
    </div>
  )
}
