import { createClient } from '@/lib/supabase/server'
import { TransactionTable } from '@/components/reports/TransactionTable'
import { Input } from '@/components/ui/input'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import Link from 'next/link'

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; type?: string }>
}

export default async function TransactionsPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const filters = await searchParams

  let query = supabase
    .from('credit_transactions')
    .select('*, agent:profiles!agent_id(full_name)')
    .order('created_at', { ascending: false })
    .limit(500)

  if (filters.type) query = query.eq('type', filters.type)
  if (filters.from) query = query.gte('created_at', filters.from)
  if (filters.to) query = query.lte('created_at', filters.to + 'T23:59:59')

  const { data: transactions } = await query

  return (
    <div className="space-y-4">
      <form method="get" className="flex gap-3 flex-wrap">
        <Input name="from" type="date" defaultValue={filters.from} className="w-40" placeholder="From" />
        <Input name="to" type="date" defaultValue={filters.to} className="w-40" placeholder="To" />
        <select name="type" defaultValue={filters.type || ''} className="border rounded-md px-3 py-2 text-sm bg-white">
          <option value="">All Types</option>
          <option value="credit">Top-up</option>
          <option value="debit">Policy sale</option>
          <option value="reserve">Offline reserve</option>
          <option value="release">Reserve released</option>
        </select>
        <Button type="submit" variant="outline">Filter</Button>
        <Link href="/reports/transactions" className={cn(buttonVariants({ variant: 'ghost' }))}>Clear</Link>
      </form>
      <TransactionTable
        transactions={(transactions ?? []) as Parameters<typeof TransactionTable>[0]['transactions']}
        showAgent
      />
    </div>
  )
}
