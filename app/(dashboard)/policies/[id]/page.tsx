import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PaymentMethodBadge, PaymentStatusBadge } from '@/components/shared/PaymentBadges'
import { STAFF_ROLES, requirePageRole } from '@/lib/auth'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatDate, formatDateTime } from '@/lib/utils/dates'
import { formatCurrency } from '@/lib/utils/currency'
import { CancelPolicyButton } from '@/components/policies/CancelPolicyButton'
import { PDFDownloadButton } from '@/components/policies/PDFDownloadButton'
import { EditPolicyDialog } from '@/components/policies/EditPolicyDialog'
import { ArrowLeft } from 'lucide-react'

/** policies.sync_flags: what the server noticed when the phone synced this offline sale */
const SYNC_FLAG_LABELS: Record<string, string> = {
  PRICE_CHANGED: 'Price differed from the current list',
  METHOD_DISABLED: 'Payment method was disabled',
  CREDIT_OVER_RESERVE: 'Exceeded offline credit (charged to wallet)',
}

export default async function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const profile = await requirePageRole(STAFF_ROLES)
  const canEdit = profile.role === 'insurer_admin'
  const supabase = await createClient()

  const { data: policy } = await supabase
    .from('policies')
    .select('*, vehicle_type:vehicle_types(*), agent:profiles!agent_id(full_name, email)')
    .eq('id', id)
    .single()

  if (!policy) notFound()

  const { data: payment } = policy.payment_method === 'POS_CARD_SLIP'
    ? await supabase.from('policy_payments')
      .select('id, status, tier, tid, rrn, auth_code, pan_last4, txn_at')
      .eq('policy_id', policy.id).maybeSingle()
    : { data: null }

  // document_url holds the storage path (older rows hold a full URL); the bucket is private
  const documentPath = policy.document_url?.split('/policy-documents/').pop()
  const { data: signedDocument } = documentPath
    ? await supabase.storage.from('policy-documents').createSignedUrl(documentPath, 300)
    : { data: null }

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
          <p className="text-gray-500 text-sm">
            {policy.issued_offline && policy.device_issued_at
              ? `Issued offline ${formatDateTime(policy.device_issued_at)} · synced ${policy.synced_at ? formatDateTime(policy.synced_at) : '—'}`
              : `Issued ${formatDateTime(policy.created_at)}`}
          </p>
          {(policy.sync_flags as string[] | null)?.map((f) => (
            <span key={f} className="inline-block mt-1 mr-1 rounded-full bg-amber-100 text-amber-800 px-2 text-xs">
              {SYNC_FLAG_LABELS[f] ?? f}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={policy.status} />
          <PaymentMethodBadge method={policy.payment_method} />
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <PDFDownloadButton policyId={policy.id} policyNumber={policy.policy_number} />
        {canEdit && policy.status !== 'cancelled' && (
          <EditPolicyDialog policy={policy} />
        )}
        {canEdit && policy.status === 'active' && (
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
            {signedDocument?.signedUrl && (
              <div className="flex gap-2">
                <span className="text-gray-500 w-32 shrink-0">Document</span>
                <a href={signedDocument.signedUrl} target="_blank" rel="noopener noreferrer"
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

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base text-brand">Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row
              label="Method"
              value={policy.payment_method === 'POS_CARD_SLIP' ? 'Card on POS terminal (slip photographed)' : "Agent's virtual credit"}
            />
            {payment && (
              <>
                <div className="flex gap-2 items-center">
                  <span className="text-gray-500 w-32 shrink-0">Card payment</span>
                  <PaymentStatusBadge status={payment.status} />
                  <Link href={`/payments/${payment.id}`} className="text-brand underline font-medium">
                    View slip check
                  </Link>
                </div>
                <Row label="Terminal (TID)" value={payment.tid} />
                <Row label="RRN / Auth" value={[payment.rrn, payment.auth_code].filter(Boolean).join(' / ') || null} />
                <Row label="Card" value={payment.pan_last4 ? `•••• ${payment.pan_last4}` : null} />
                <Row label="Slip time" value={payment.txn_at ? formatDateTime(payment.txn_at) : null} />
              </>
            )}
            {policy.payment_method === 'POS_CARD_SLIP' && !payment && (
              <p className="text-gray-500">The slip record has not reached the server yet (the phone syncs it).</p>
            )}
            {policy.issued_offline && (
              <Row
                label="Issued offline"
                value={`On the phone at ${policy.device_issued_at ? formatDateTime(policy.device_issued_at) : '—'}${policy.synced_at ? `, synced ${formatDateTime(policy.synced_at)}` : ''}`}
              />
            )}
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
