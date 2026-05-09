import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CommissionTable } from '@/components/reports/CommissionTable'
import { Input } from '@/components/ui/input'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; type?: string }>
}

export default async function CommissionsPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const filters = await searchParams

  let query = supabase
    .from('commissions')
    .select('*, agent:profiles!agent_id(full_name), policy:policies!policy_id(policy_number)')
    .order('created_at', { ascending: false })
    .limit(500)

  if (profile?.role !== 'admin') query = query.eq('agent_id', user.id)
  if (filters.type) query = query.eq('commission_type', filters.type)
  if (filters.from) query = query.gte('created_at', filters.from)
  if (filters.to) query = query.lte('created_at', filters.to + 'T23:59:59')

  const { data: commissions } = await query

  return (
    <div className="space-y-4">
      <form method="get" className="flex gap-3 flex-wrap">
        <Input name="from" type="date" defaultValue={filters.from} className="w-40" />
        <Input name="to" type="date" defaultValue={filters.to} className="w-40" />
        <select name="type" defaultValue={filters.type || ''} className="border rounded-md px-3 py-2 text-sm bg-white">
          <option value="">All Types</option>
          <option value="direct">Direct</option>
          <option value="override">Override</option>
        </select>
        <Button type="submit" variant="outline">Filter</Button>
        <Link href="/reports/commissions" className={cn(buttonVariants({ variant: 'ghost' }))}>Clear</Link>
      </form>
      <CommissionTable commissions={(commissions ?? []) as Parameters<typeof CommissionTable>[0]['commissions']} />
    </div>
  )
}
