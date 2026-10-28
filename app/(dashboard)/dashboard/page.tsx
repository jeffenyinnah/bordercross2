import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { STAFF_ROLES, requirePageRole } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils/currency'
import { AlertTriangle, CreditCard, FileText, TrendingUp, Users } from 'lucide-react'
import { PolicyDistributionChart } from '@/components/dashboard/PolicyDistributionChart'

// Row-level security scopes every query: platform admins see all insurers,
// insurer staff only their own.
export default async function DashboardPage() {
  const profile = await requirePageRole(STAFF_ROLES)
  const supabase = await createClient()

  const today = new Date().toISOString().split('T')[0]
  const monthStart = today.slice(0, 8) + '01'

  const [
    { count: todayPolicies },
    { count: totalAgents },
    { data: monthPolicies },
    { data: activePolicies },
    { count: reviewCount },
  ] = await Promise.all([
    supabase.from('policies').select('*', { count: 'exact', head: true }).gte('created_at', today),
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'agent').eq('is_active', true),
    supabase.from('policies').select('premium_amount, payment_method')
      .gte('created_at', monthStart).neq('status', 'cancelled'),
    supabase.from('policies').select('policy_type').eq('status', 'active'),
    supabase.from('policy_payments').select('*', { count: 'exact', head: true })
      .in('status', ['NEEDS_REVIEW', 'CONFLICT']),
  ])

  const monthTotal = (method?: string) => (monthPolicies ?? [])
    .filter((p) => !method || p.payment_method === method)
    .reduce((sum, p) => sum + Number(p.premium_amount), 0)

  const policyTypeDistribution = {
    monthly: activePolicies?.filter((p) => p.policy_type === 'monthly').length || 0,
    annual: activePolicies?.filter((p) => p.policy_type === 'annual').length || 0,
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {(reviewCount ?? 0) > 0 && (
        <Link
          href="/payments"
          className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-800 hover:bg-amber-100"
        >
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>
            <b>{reviewCount}</b> card payment{reviewCount === 1 ? '' : 's'} need{reviewCount === 1 ? 's' : ''} review.
          </span>
        </Link>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Policies Today</CardTitle>
            <FileText className="w-4 h-4 text-brand" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-brand">{todayPolicies ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Premium This Month</CardTitle>
            <TrendingUp className="w-4 h-4 text-brand" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-brand">{formatCurrency(monthTotal())}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Card Payments This Month</CardTitle>
            <CreditCard className="w-4 h-4 text-brand" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-brand">{formatCurrency(monthTotal('POS_CARD_SLIP'))}</div>
            <p className="text-xs text-gray-500 mt-1">Virtual credit: {formatCurrency(monthTotal('VIRTUAL_CREDIT'))}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Active Agents</CardTitle>
            <Users className="w-4 h-4 text-brand" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-brand">{totalAgents ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Active Policies by Cover</CardTitle>
        </CardHeader>
        <CardContent>
          <PolicyDistributionChart data={policyTypeDistribution} />
        </CardContent>
      </Card>

      {profile.role === 'admin' && (
        <p className="text-xs text-gray-400">Figures include every insurer.</p>
      )}
    </div>
  )
}
