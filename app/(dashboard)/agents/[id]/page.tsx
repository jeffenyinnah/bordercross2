import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePageRole } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TopUpDialog } from '@/components/agents/TopUpDialog'
import { AgentStatusButton, EditAgentDialog } from '@/components/agents/EditAgentDialog'
import { AgentDevices } from '@/components/agents/AgentDevices'
import { PolicyTable } from '@/components/policies/PolicyTable'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDateTime } from '@/lib/utils/dates'
import { ArrowLeft } from 'lucide-react'
import type { Device, NumberLease, OfflineCreditLease, Profile } from '@/lib/types'

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

const TX_LABELS: Record<string, string> = {
  credit: 'Top-up', debit: 'Policy sale', reserve: 'Reserved for offline', release: 'Offline reserve released',
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const profile = await requirePageRole(['admin', 'insurer_admin'])
  // the platform admin looks; the agent's insurer acts
  const canManage = profile.role === 'insurer_admin'
  const supabase = await createClient()

  // row-level security: insurer admins only find their own insurer's agents
  const { data: agent } = await supabase
    .from('profiles')
    .select('*, parent:profiles!parent_agent_id(full_name), insurer:insurers(name), border_post:border_posts(name)')
    .eq('id', id)
    .eq('role', 'agent')
    .single()

  if (!agent) notFound()

  const [
    { data: wallet }, { data: transactions }, { data: policies }, { data: siblings },
    { data: borderPosts }, { data: devices }, { data: creditLeases },
  ] = await Promise.all([
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
    supabase.from('profiles').select('id, full_name')
      .eq('role', 'agent').eq('insurer_id', agent.insurer_id).order('full_name'),
    supabase.from('border_posts').select('id, name').eq('is_active', true).order('name'),
    supabase.from('devices').select('*').eq('agent_id', id).order('registered_at', { ascending: false }),
    supabase.from('offline_credit_leases').select('*').eq('agent_id', id),
  ])

  const deviceIds = (devices ?? []).map((d) => d.id)
  const { data: numberLeases } = deviceIds.length
    ? await supabase.from('policy_number_leases').select('*').in('device_id', deviceIds).is('closed_at', null)
    : { data: [] }

  const reserved = (creditLeases ?? [])
    .filter((c) => c.status === 'active')
    .reduce((n, c) => n + Number(c.reserved) - Number(c.consumed), 0)

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/agents" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Agents
        </Link>
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{agent.full_name}</h1>
          <p className="text-gray-500 text-sm">{agent.email} · {one(agent.insurer)?.name ?? '—'}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Badge className={agent.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}>
            {agent.is_active ? 'Active' : 'Inactive'}
          </Badge>
          {canManage && (
            <>
              <EditAgentDialog
                agent={agent}
                allAgents={(siblings ?? []) as Pick<Profile, 'id' | 'full_name'>[]}
                borderPosts={borderPosts ?? []}
              />
              <AgentStatusButton agent={agent} />
              <TopUpDialog agentId={agent.id} agentName={agent.full_name} />
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-500">Wallet balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-brand">{formatCurrency(wallet?.balance_mzn ?? 0)}</div>
            <p className="text-xs text-gray-500 mt-1">Available for online credit sales</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-500">Reserved on phones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-700">{formatCurrency(reserved)}</div>
            <p className="text-xs text-gray-500 mt-1">Moved out of the wallet for offline credit sales</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-500">Border post</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">{one(agent.border_post)?.name ?? 'Not assigned'}</div>
          </CardContent>
        </Card>
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
          <div className="font-bold">{one(agent.parent)?.full_name ?? '—'}</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-gray-500">Member Since</div>
          <div className="font-bold">{formatDateTime(agent.created_at).split(' ')[0]}</div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Phones</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentDevices
            agentId={agent.id}
            devices={(devices ?? []) as Device[]}
            numberLeases={(numberLeases ?? []) as NumberLease[]}
            creditLeases={(creditLeases ?? []) as OfflineCreditLease[]}
            canRevoke={canManage}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Wallet Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {!transactions?.length ? (
            <p className="text-gray-400 text-sm text-center py-4">No transactions yet</p>
          ) : (
            <div className="divide-y">
              {transactions.map((tx) => {
                const isIn = tx.type === 'credit' || tx.type === 'release'
                return (
                  <div key={tx.id} className="flex items-center justify-between py-3 text-sm">
                    <div>
                      <span className={`font-medium ${isIn ? 'text-green-700' : 'text-red-600'}`}>
                        {isIn ? '+' : '-'}
                        {formatCurrency(tx.amount)}
                      </span>
                      <span className="text-gray-500 ml-2">{TX_LABELS[tx.type] ?? tx.type}</span>
                      {tx.description && <span className="text-gray-400 ml-2">{tx.description}</span>}
                    </div>
                    <div className="text-gray-400 text-xs">{formatDateTime(tx.created_at)}</div>
                  </div>
                )
              })}
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
