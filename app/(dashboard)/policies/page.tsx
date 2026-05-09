import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PolicyTable } from '@/components/policies/PolicyTable'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FilePlus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PageProps {
  searchParams: Promise<{ search?: string; status?: string; type?: string; currency?: string }>
}

export default async function PoliciesPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const filters = await searchParams

  let query = supabase
    .from('policies')
    .select('*, vehicle_type:vehicle_types(name), agent:profiles!agent_id(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(200)

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.type) query = query.eq('policy_type', filters.type)
  if (filters.currency) query = query.eq('currency', filters.currency)
  if (filters.search) {
    query = query.or(
      `policy_number.ilike.%${filters.search}%,client_name.ilike.%${filters.search}%,plate_number.ilike.%${filters.search}%`
    )
  }

  const { data: policies } = await query

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Policies</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {policies?.length ?? 0} policies found
          </p>
        </div>
        <Link href="/policies/new" className={cn(buttonVariants(), 'bg-brand hover:bg-brand/90')}>
          <FilePlus className="w-4 h-4 mr-2" />
          New Policy
        </Link>
      </div>

      <form method="get" className="flex gap-3 flex-wrap">
        <Input
          name="search"
          defaultValue={filters.search}
          placeholder="Search policy #, client, plate…"
          className="max-w-xs"
        />
        <select
          name="status"
          defaultValue={filters.status || ''}
          className="border rounded-md px-3 py-2 text-sm bg-white"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          name="type"
          defaultValue={filters.type || ''}
          className="border rounded-md px-3 py-2 text-sm bg-white"
        >
          <option value="">All Types</option>
          <option value="monthly">Monthly</option>
          <option value="annual">Annual</option>
        </select>
        <select
          name="currency"
          defaultValue={filters.currency || ''}
          className="border rounded-md px-3 py-2 text-sm bg-white"
        >
          <option value="">All Currencies</option>
          <option value="MZN">MZN</option>
          <option value="ZAR">ZAR</option>
          <option value="USD">USD</option>
        </select>
        <Button type="submit" variant="outline">Filter</Button>
        <Link href="/policies" className={cn(buttonVariants({ variant: 'ghost' }))}>Clear</Link>
      </form>

      <PolicyTable policies={policies ?? []} showAgent={profile?.role === 'admin'} />
    </div>
  )
}
