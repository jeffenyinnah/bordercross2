import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AgentTable } from '@/components/agents/AgentTable'
import { CreateAgentDialog } from '@/components/agents/CreateAgentDialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle } from 'lucide-react'

export default async function AgentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/dashboard')

  const { data: agents } = await supabase
    .from('profiles')
    .select('*, wallet:credit_wallets(*), parent:profiles!parent_agent_id(full_name)')
    .eq('role', 'agent')
    .order('full_name')

  const agentList = (agents ?? []).map((a: Record<string, unknown>) => ({
    ...a,
    wallet: Array.isArray(a.wallet) ? a.wallet[0] : a.wallet,
    parent: Array.isArray(a.parent) ? a.parent[0] : a.parent,
  }))

  const serviceKeyMissing =
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY === 'your_service_role_key'

  return (
    <div className="space-y-5">
      {serviceKeyMissing && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-700">
            <strong>SUPABASE_SERVICE_ROLE_KEY</strong> is not set in <code>.env.local</code>.
            Agent creation will fail until you add it. Get it from{' '}
            <strong>Supabase Dashboard → Project Settings → API → service_role key</strong>.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agents</h1>
          <p className="text-gray-500 text-sm mt-0.5">{agents?.length ?? 0} agents</p>
        </div>
        <CreateAgentDialog agents={(agents ?? []).map((a) => ({ id: a.id, full_name: a.full_name }))} />
      </div>
      <AgentTable agents={agentList as Parameters<typeof AgentTable>[0]['agents']} />
    </div>
  )
}
