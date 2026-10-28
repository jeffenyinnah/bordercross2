import { createClient } from '@/lib/supabase/server'
import { requirePageRole } from '@/lib/auth'
import { AgentTable, type AgentRow } from '@/components/agents/AgentTable'
import { CreateAgentDialog } from '@/components/agents/CreateAgentDialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle } from 'lucide-react'

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

export default async function AgentsPage() {
  const profile = await requirePageRole(['admin', 'insurer_admin'])
  const isAdmin = profile.role === 'admin'
  const supabase = await createClient()

  // row-level security limits insurer admins to their own insurer's agents
  const [{ data: agents }, { data: borderPosts }] = await Promise.all([
    supabase
      .from('profiles')
      .select('*, wallet:credit_wallets(*), parent:profiles!parent_agent_id(full_name), insurer:insurers(name), border_post:border_posts(name)')
      .eq('role', 'agent')
      .order('full_name'),
    supabase.from('border_posts').select('id, name').eq('is_active', true).order('name'),
  ])

  const agentList = (agents ?? []).map((a) => ({
    ...a,
    wallet: one(a.wallet),
    parent: one(a.parent),
    insurer: one(a.insurer),
    border_post: one(a.border_post),
  })) as AgentRow[]

  const serviceKeyMissing =
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY === 'your_service_role_key'

  return (
    <div className="space-y-5">
      {serviceKeyMissing && !isAdmin && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-700">
            <strong>SUPABASE_SERVICE_ROLE_KEY</strong> is not set in <code>.env.local</code>.
            Agent creation will fail until you add it. Get it from{' '}
            <strong>Supabase Dashboard → Project Settings → API → service_role key</strong>.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agents</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {agentList.length} agents · they sell on Android phones at <code>/agent</code>
            {isAdmin && ' · each insurer manages its own agents (view only)'}
          </p>
        </div>
        {!isAdmin && (
          <CreateAgentDialog
            agents={agentList.map((a) => ({ id: a.id, full_name: a.full_name }))}
            borderPosts={borderPosts ?? []}
          />
        )}
      </div>
      <AgentTable agents={agentList} showInsurer={isAdmin} />
    </div>
  )
}
