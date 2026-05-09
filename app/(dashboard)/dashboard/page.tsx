import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/dates'
import { CurrencyBadge } from '@/components/shared/CurrencyBadge'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { FileText, Users, Wallet, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { PolicyDistributionChart } from '@/components/dashboard/PolicyDistributionChart'
import type { Policy, Currency } from '@/lib/types'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  const today = new Date().toISOString().split('T')[0]

  if (profile.role === 'admin') {
    const [{ count: todayPolicies }, { count: totalAgents }, { data: policies }, { data: allPolicies }] =
      await Promise.all([
        supabase
          .from('policies')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', today),
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'agent'),
        supabase
          .from('policies')
          .select('currency, premium_amount')
          .eq('status', 'active'),
        supabase
          .from('policies')
          .select('policy_type, id')
          .eq('status', 'active'),
      ])

    const revenue: Record<Currency, number> = { MZN: 0, ZAR: 0, USD: 0 }
    policies?.forEach((p) => {
      revenue[p.currency as Currency] = (revenue[p.currency as Currency] || 0) + p.premium_amount
    })

    const policyTypeDistribution = {
      monthly: allPolicies?.filter((p) => p.policy_type === 'monthly').length || 0,
      annual: allPolicies?.filter((p) => p.policy_type === 'annual').length || 0,
    }

    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
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
              <CardTitle className="text-sm font-medium text-gray-600">Total Agents</CardTitle>
              <Users className="w-4 h-4 text-brand" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-brand">{totalAgents ?? 0}</div>
            </CardContent>
          </Card>
          {(['MZN', 'ZAR', 'USD'] as Currency[]).map((cur) => (
            <Card key={cur}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">
                  Credit Distributed ({cur})
                </CardTitle>
                <TrendingUp className="w-4 h-4 text-brand" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-brand">
                  {formatCurrency(revenue[cur], cur)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Policy Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <PolicyDistributionChart data={policyTypeDistribution} />
          </CardContent>
        </Card>
      </div>
    )
  }

  // Agent dashboard
  const [
    { count: myPoliciesCount },
    { data: wallet },
    { data: commissions },
    { data: recentPolicies },
  ] = await Promise.all([
    supabase
      .from('policies')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', user.id)
      .gte('created_at', today),
    supabase.from('credit_wallets').select('*').eq('agent_id', user.id).single(),
    supabase
      .from('commissions')
      .select('amount, currency')
      .eq('agent_id', user.id)
      .gte('created_at', new Date(new Date().setDate(1)).toISOString()),
    supabase
      .from('policies')
      .select('*, vehicle_type:vehicle_types(name)')
      .eq('agent_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const monthlyCommissions: Record<Currency, number> = { MZN: 0, ZAR: 0, USD: 0 }
  commissions?.forEach((c) => {
    monthlyCommissions[c.currency as Currency] =
      (monthlyCommissions[c.currency as Currency] || 0) + c.amount
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">My Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">My Policies Today</CardTitle>
            <FileText className="w-4 h-4 text-brand" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-brand">{myPoliciesCount ?? 0}</div>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Wallet Balance</CardTitle>
            <Wallet className="w-4 h-4 text-brand" />
          </CardHeader>
          <CardContent>
            <div className="flex gap-6">
              {(['MZN', 'ZAR', 'USD'] as Currency[]).map((cur) => (
                <div key={cur}>
                  <div className="text-xs text-gray-500">{cur}</div>
                  <div className="text-lg font-bold text-brand">
                    {formatCurrency(
                      wallet ? wallet[`balance_${cur.toLowerCase()}` as keyof typeof wallet] as number : 0,
                      cur
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Recent Policies</CardTitle>
        </CardHeader>
        <CardContent>
          {!recentPolicies?.length ? (
            <p className="text-gray-400 text-sm text-center py-6">No policies yet</p>
          ) : (
            <div className="space-y-2">
              {(recentPolicies as Policy[]).map((p) => (
                <Link
                  key={p.id}
                  href={`/policies/${p.id}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <div>
                    <div className="font-medium text-sm text-gray-900">{p.policy_number}</div>
                    <div className="text-xs text-gray-500">
                      {p.client_name} · {p.plate_number}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <CurrencyBadge currency={p.currency} />
                    <StatusBadge status={p.status} />
                    <span className="text-xs text-gray-400">{formatDate(p.created_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
