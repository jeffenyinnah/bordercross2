import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TopUpDialog } from '@/components/agents/TopUpDialog'
import { EditAgentDialog } from '@/components/agents/EditAgentDialog'
import { PolicyTable } from '@/components/policies/PolicyTable'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDateTime } from '@/lib/utils/dates'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import type { Currency, Profile } from '@/lib/types'

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const { data: agent } = await supabase
    .from('profiles')
    .select('*, parent:profiles!parent_agent_id(full_name)')
    .eq('id', id)
    .single()

  if (!agent) notFound()

  const [{ data: wallet }, { data: transactions }, { data: policies }, { data: allAgents }] = await Promise.all([
    supabase.from('credit_wallets').select('*').eq('agent_id', id).single(),
    supabase
      .from('credit_transactions')
      .select('*')
      .eq('agent_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('policies')
      .select('*, vehicle_type:vehicle_types(name)')
      .eq('agent_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('profiles').select('id, full_name').eq('role', 'agent').order('full_name'),
  ])

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/agents" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Agents
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{agent.full_name}</h1>
          <p className="text-gray-500 text-sm">{agent.email}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Badge className={agent.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}>
            {agent.is_active ? 'Active' : 'Inactive'}
          </Badge>
          <EditAgentDialog
            agent={agent}
            allAgents={(allAgents ?? []) as Pick<Profile, 'id' | 'full_name'>[]}
          />
          <TopUpDialog agentId={agent.id} agentName={agent.full_name} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(['MZN', 'ZAR', 'USD'] as Currency[]).map((cur) => (
          <Card key={cur}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-500">{cur} Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-brand">
                {formatCurrency(
                  wallet ? (wallet[`balance_${cur.toLowerCase()}` as keyof typeof wallet] as number) : 0,
                  cur
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-gray-500">Commission Rate</div>
          <div className="font-bold text-lg">{agent.commission_rate}%</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-gray-500">Override Rate</div>
          <div className="font-bold text-lg">{agent.sub_agent_override_rate}%</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-gray-500">Parent Agent</div>
          <div className="font-bold">
            {Array.isArray(agent.parent) ? agent.parent[0]?.full_name ?? '—' : (agent.parent as { full_name?: string } | null)?.full_name ?? '—'}
          </div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-gray-500">Member Since</div>
          <div className="font-bold">{formatDateTime(agent.created_at).split(' ')[0]}</div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Wallet Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {!transactions?.length ? (
            <p className="text-gray-400 text-sm text-center py-4">No transactions yet</p>
          ) : (
            <div className="divide-y">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <span
                      className={`font-medium ${tx.type === 'credit' ? 'text-green-700' : 'text-red-600'}`}
                    >
                      {tx.type === 'credit' ? '+' : '-'}
                      {formatCurrency(tx.amount, tx.currency)}
                    </span>
                    <span className="text-gray-400 ml-2">{tx.description}</span>
                  </div>
                  <div className="text-gray-400 text-xs">{formatDateTime(tx.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Policies</CardTitle>
        </CardHeader>
        <CardContent>
          <PolicyTable policies={(policies ?? []) as Parameters<typeof PolicyTable>[0]['policies']} />
        </CardContent>
      </Card>
    </div>
  )
}
