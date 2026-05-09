import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PolicyTable } from '@/components/policies/PolicyTable'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils/currency'
import type { Currency, PolicyStatus } from '@/lib/types'

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; type?: string; status?: string; currency?: string }>
}

export default async function PolicyReportPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const filters = await searchParams

  let query = supabase
    .from('policies')
    .select('*, vehicle_type:vehicle_types(name), agent:profiles!agent_id(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(500)

  if (filters.status) query = query.eq('status', filters.status as PolicyStatus)
  if (filters.type) query = query.eq('policy_type', filters.type)
  if (filters.currency) query = query.eq('currency', filters.currency as Currency)
  if (filters.from) query = query.gte('created_at', filters.from)
  if (filters.to) query = query.lte('created_at', filters.to + 'T23:59:59')

  const { data: policies } = await query

  const total = policies?.length ?? 0
  const revenue: Record<Currency, number> = { MZN: 0, ZAR: 0, USD: 0 }
  const statusCounts: Record<PolicyStatus, number> = { active: 0, expired: 0, cancelled: 0 }

  policies?.forEach((p) => {
    revenue[p.currency as Currency] += p.premium_amount
    statusCounts[p.status as PolicyStatus]++
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-brand">{total}</div>
            <div className="text-sm text-gray-500">Total Policies</div>
          </CardContent>
        </Card>
        {(['MZN', 'ZAR', 'USD'] as Currency[]).map((cur) => (
          <Card key={cur}>
            <CardContent className="pt-4">
              <div className="text-xl font-bold text-brand">{formatCurrency(revenue[cur], cur)}</div>
              <div className="text-sm text-gray-500">Revenue ({cur})</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <form method="get" className="flex gap-3 flex-wrap">
        <Input name="from" type="date" defaultValue={filters.from} className="w-40" />
        <Input name="to" type="date" defaultValue={filters.to} className="w-40" />
        <select name="type" defaultValue={filters.type || ''} className="border rounded-md px-3 py-2 text-sm bg-white">
          <option value="">All Types</option>
          <option value="monthly">Monthly</option>
          <option value="annual">Annual</option>
        </select>
        <select name="status" defaultValue={filters.status || ''} className="border rounded-md px-3 py-2 text-sm bg-white">
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select name="currency" defaultValue={filters.currency || ''} className="border rounded-md px-3 py-2 text-sm bg-white">
          <option value="">All Currencies</option>
          <option value="MZN">MZN</option>
          <option value="ZAR">ZAR</option>
          <option value="USD">USD</option>
        </select>
        <Button type="submit" variant="outline">Filter</Button>
        <Link href="/reports/policies" className={cn(buttonVariants({ variant: 'ghost' }))}>Clear</Link>
      </form>

      <PolicyTable policies={(policies ?? []) as Parameters<typeof PolicyTable>[0]['policies']} showAgent={profile?.role === 'admin'} />
    </div>
  )
}
