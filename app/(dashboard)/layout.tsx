import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileNav } from '@/components/layout/MobileNav'
import { Header } from '@/components/layout/Header'
import { Toaster } from '@/components/ui/sonner'
import { NoProfileError } from '@/components/layout/NoProfileError'
import { InactiveAccount } from '@/components/layout/InactiveAccount'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return <NoProfileError email={user.email ?? ''} userId={user.id} />
  }

  if (!profile.is_active) {
    return <InactiveAccount email={user.email ?? ''} />
  }

  // agents work in the offline-first phone app
  if (profile.role === 'agent') redirect('/agent')

  let insurerName: string | null = null
  if (profile.insurer_id && profile.role !== 'admin') {
    const { data: insurer } = await supabase.from('insurers').select('name').eq('id', profile.insurer_id).single()
    insurerName = insurer?.name ?? null
  }

  return (
    <div className="flex min-h-screen bg-slate-50 flex-col md:flex-row">
      <Sidebar role={profile.role} />
      <div className="flex-1 flex flex-col min-w-0">
        <MobileNav role={profile.role} />
        <Header profile={profile} insurerName={insurerName} />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
      <Toaster richColors position="top-right" />
    </div>
  )
}
