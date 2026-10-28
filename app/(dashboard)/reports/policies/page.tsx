import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PolicyTable } from '@/components/policies/PolicyTable'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils/currency'
import type { PolicyStatus } from '@/lib/types'

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; type?: string; status?: string; method?: string }>
}

export default async function PolicyReportPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const filters = await searchParams

  let query = supabase
    .from('policies')
    .select('*, vehicle_type:vehicle_types(name), agent:profiles!agent_id(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(500)

  if (filters.status) query = query.eq('status', filters.status as PolicyStatus)
  if (filters.type) query = query.eq('policy_type', filters.type)
  if (filters.method) query = query.eq('payment_method', filters.method)
  if (filters.from) query = query.gte('created_at', filters.from)
  if (filters.to) query = query.lte('created_at', filters.to + 'T23:59:59')

  const { data: policies } = await query

  const total = policies?.length ?? 0
  const statusCounts: Record<PolicyStatus, number> = { active: 0, expired: 0, cancelled: 0 }
  const revenue = { all: 0, VIRTUAL_CREDIT: 0, POS_CARD_SLIP: 0 }

  policies?.forEach((p) => {
    statusCounts[p.status as PolicyStatus]++
    if (p.status === 'cancelled') return
    revenue.all += Number(p.premium_amount)
    revenue[p.payment_method as 'VIRTUAL_CREDIT' | 'POS_CARD_SLIP'] += Number(p.premium_amount)
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
        {([
          ['all', 'Premium (excl. cancelled)'],
          ['VIRTUAL_CREDIT', 'Paid by virtual credit'],
          ['POS_CARD_SLIP', 'Paid by card'],
        ] as const).map(([key, label]) => (
          <Card key={key}>
            <CardContent className="pt-4">
              <div className="text-xl font-bold text-brand">{formatCurrency(revenue[key])}</div>
              <div className="text-sm text-gray-500">{label}</div>
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
        <select name="method" defaultValue={filters.method || ''} className="border rounded-md px-3 py-2 text-sm bg-white">
          <option value="">All Payments</option>
          <option value="VIRTUAL_CREDIT">Virtual credit</option>
          <option value="POS_CARD_SLIP">Card (POS)</option>
        </select>
        <Button type="submit" variant="outline">Filter</Button>
        <Link href="/reports/policies" className={cn(buttonVariants({ variant: 'ghost' }))}>Clear</Link>
      </form>

      <PolicyTable policies={(policies ?? []) as Parameters<typeof PolicyTable>[0]['policies']} showAgent />
    </div>
  )
}
