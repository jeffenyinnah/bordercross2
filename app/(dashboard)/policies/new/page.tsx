import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PolicyForm } from '@/components/policies/PolicyForm'

export default async function NewPolicyPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'

  const [{ data: vehicleTypes }, { data: wallet }, { data: borderPosts }] = await Promise.all([
    supabase.from('vehicle_types').select('*').eq('is_active', true).order('name'),
    isAdmin
      ? Promise.resolve({ data: null })
      : supabase.from('credit_wallets').select('*').eq('agent_id', user.id).single(),
    supabase.from('border_posts').select('id, name, code').eq('is_active', true).order('name'),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">New Policy</h1>
        <p className="text-gray-500 text-sm mt-1">Issue a third-party vehicle insurance policy</p>
      </div>
      <PolicyForm
        vehicleTypes={vehicleTypes ?? []}
        wallet={wallet ?? null}
        isAdmin={isAdmin}
        borderPosts={borderPosts ?? []}
      />
    </div>
  )
}
