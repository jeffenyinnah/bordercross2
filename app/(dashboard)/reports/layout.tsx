import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NavTabs } from '@/components/shared/NavTabs'

const REPORTS_TABS = [
  { label: 'Transactions', href: '/reports/transactions' },
  { label: 'Policies', href: '/reports/policies' },
  { label: 'Commissions', href: '/reports/commissions' },
]

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/dashboard')

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
      <NavTabs tabs={REPORTS_TABS} />
      {children}
    </div>
  )
}
