import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CurrencyBadge } from '@/components/shared/CurrencyBadge'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatDate, formatDateTime } from '@/lib/utils/dates'
import { formatCurrency } from '@/lib/utils/currency'
import { CancelPolicyButton } from '@/components/policies/CancelPolicyButton'
import { PDFDownloadButton } from '@/components/policies/PDFDownloadButton'
import { EditPolicyDialog } from '@/components/policies/EditPolicyDialog'
import { ArrowLeft } from 'lucide-react'

export default async function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: policy } = await supabase
    .from('policies')
    .select('*, vehicle_type:vehicle_types(*), agent:profiles!agent_id(full_name, email)')
    .eq('id', id)
    .single()

  if (!policy) notFound()

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/policies" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Policies
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand">{policy.policy_number}</h1>
          <p className="text-gray-500 text-sm">Issued {formatDateTime(policy.created_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={policy.status} />
          <CurrencyBadge currency={policy.currency} />
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <PDFDownloadButton policyId={policy.id} policyNumber={policy.policy_number} />
        {profile?.role === 'admin' && (
          <EditPolicyDialog policy={policy} />
        )}
        {profile?.role === 'admin' && policy.status === 'active' && (
          <CancelPolicyButton policyId={policy.id} />
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-brand">Coverage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Policy Type" value={policy.policy_type === 'annual' ? 'Annual (365 days)' : 'Monthly (30 days)'} />
            <Row label="Premium" value={formatCurrency(policy.premium_amount, policy.currency)} />
            <Row label="Start Date" value={formatDate(policy.start_date)} />
            <Row label="End Date" value={formatDate(policy.end_date)} />
            <Row label="Vehicle Category" value={policy.vehicle_type?.name} />
            <Row label="Border Post" value={policy.border} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-brand">Client</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Name" value={policy.client_name} />
            <Row label="Nationality" value={policy.client_nationality} />
            <Row label="ID / Passport" value={policy.client_id_number} />
            <Row label="Doc Type" value={policy.document_type} />
            {policy.document_url && (
              <div className="flex gap-2">
                <span className="text-gray-500 w-32 shrink-0">Document</span>
                <a href={policy.document_url} target="_blank" rel="noopener noreferrer"
                  className="text-brand underline font-medium text-sm">
                  View Document
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-brand">Vehicle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Plate" value={policy.plate_number} />
            <Row label="Brand" value={policy.vehicle_brand} />
            <Row label="Model" value={policy.vehicle_model} />
            <Row label="Year" value={policy.vehicle_year?.toString()} />
            <Row label="Engine #" value={policy.engine_number} />
            <Row label="Chassis / VIN" value={policy.chassis_number} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-brand">Issuing Agent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Agent" value={policy.agent?.full_name} />
            <Row label="Email" value={policy.agent?.email} />
            {policy.notes && <Row label="Notes" value={policy.notes} />}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <span className="text-gray-500 w-32 shrink-0">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  )
}
