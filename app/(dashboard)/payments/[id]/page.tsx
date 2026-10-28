import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePageRole, STAFF_ROLES } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PaymentStatusBadge } from '@/components/shared/PaymentBadges'
import { ReviewPaymentForm } from '@/components/payments/ReviewPaymentForm'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDateTime } from '@/lib/utils/dates'
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import type { PolicyPayment } from '@/lib/types'

/** Storage bucket the phones upload slip photos to (created with the sync step). */
const SLIP_BUCKET = 'card-slips'

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

const SLIP_FIELDS: { key: keyof PolicyPayment; label: string }[] = [
  { key: 'bank_brand', label: 'Bank' },
  { key: 'merchant_name', label: 'Merchant' },
  { key: 'tid', label: 'TID' },
  { key: 'mid', label: 'MID' },
  { key: 'recibo_no', label: 'Receipt no.' },
  { key: 'txn_type', label: 'Transaction' },
  { key: 'approval_status', label: 'Result' },
  { key: 'rc', label: 'Response code' },
  { key: 'auth_code', label: 'Auth code' },
  { key: 'rrn', label: 'RRN' },
  { key: 'card_type', label: 'Card' },
  { key: 'pan_last4', label: 'Card last 4' },
  { key: 'batch', label: 'Batch' },
  { key: 'copy_type', label: 'Copy' },
]

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await requirePageRole(STAFF_ROLES)
  const supabase = await createClient()

  const { data } = await supabase
    .from('policy_payments')
    .select(`*, policy:policies(id, policy_number, client_name, plate_number, status, created_at),
      agent:profiles!agent_id(full_name), border_post:border_posts(name), insurer:insurers(name),
      reviewer:profiles!reviewed_by(full_name), terminal:terminals!matched_terminal_id(tid, bank)`)
    .eq('id', id)
    .single()
  if (!data) notFound()
  const p = data as PolicyPayment & Record<string, unknown>
  const policy = one(data.policy)

  let photoUrl: string | null = null
  if (p.image_path) {
    const { data: signed } = await supabase.storage.from(SLIP_BUCKET).createSignedUrl(p.image_path, 600)
    photoUrl = signed?.signedUrl ?? null
  }

  const amountMismatch = p.amount !== null && Number(p.amount) !== Number(p.expected_amount)
  const editedFields = new Set(p.edits.map((e) => e.field))
  const reviewable = p.status === 'NEEDS_REVIEW' || p.status === 'CONFLICT'

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href="/payments" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Card Payments
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Card payment</h1>
          <p className="text-gray-500 text-sm">
            {one(data.agent)?.full_name} · {one(data.border_post)?.name ?? 'No border post'} · {one(data.insurer)?.name}
          </p>
        </div>
        <PaymentStatusBadge status={p.status} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-500">Charged</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatCurrency(Number(p.expected_amount))}</div></CardContent>
        </Card>
        <Card className={amountMismatch ? 'border-red-300' : ''}>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-500">On the slip</CardTitle></CardHeader>
          <CardContent>
            <div className={cn('text-2xl font-bold', amountMismatch && 'text-red-600')}>
              {p.amount === null ? '—' : `${Number(p.amount).toFixed(2)} ${p.currency ?? ''}`}
            </div>
            {p.txn_at && <p className="text-xs text-gray-500 mt-1">{formatDateTime(p.txn_at)}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-500">Policy</CardTitle></CardHeader>
          <CardContent>
            {policy ? (
              <>
                <Link href={`/policies/${policy.id}`} className="font-mono font-bold text-brand hover:underline">
                  {policy.policy_number}
                </Link>
                <p className="text-xs text-gray-500 mt-1">
                  {policy.client_name} · {policy.plate_number} · {policy.status}
                </p>
              </>
            ) : <span className="text-gray-500">No policy (declined)</span>}
          </CardContent>
        </Card>
      </div>

      {reviewable && profile.role !== 'admin' && (
        <Card className="border-amber-300">
          <CardHeader><CardTitle className="text-base">Decision</CardTitle></CardHeader>
          <CardContent><ReviewPaymentForm paymentId={p.id} /></CardContent>
        </Card>
      )}
      {p.reviewed_at && (
        <div className="bg-white border rounded-lg p-4 text-sm">
          Reviewed by <strong>{one(data.reviewer)?.full_name ?? 'staff'}</strong> on {formatDateTime(p.reviewed_at)}
          {p.review_note && <p className="text-gray-600 mt-1">“{p.review_note}”</p>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Checks</CardTitle></CardHeader>
          <CardContent>
            {!p.checks.length ? <p className="text-sm text-gray-400">No checks recorded</p> : (
              <ul className="space-y-2 text-sm">
                {p.checks.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    {c.pass
                      ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                      : c.severity === 'HARD'
                        ? <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        : <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />}
                    <div>
                      <div className={c.pass ? 'text-gray-600' : 'font-medium'}>{c.message}</div>
                      {!c.pass && (c.expected || c.actual) && (
                        <div className="text-xs text-gray-500">
                          expected {c.expected ?? '—'} · slip {c.actual ?? '—'}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Slip photo</CardTitle></CardHeader>
          <CardContent>
            {photoUrl
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              ? <a href={photoUrl} target="_blank" rel="noreferrer"><img src={photoUrl} alt="Card slip" className="max-h-[480px] rounded border" /></a>
              : <p className="text-sm text-gray-500">
                  {p.image_path ? 'The photo could not be loaded.' : 'The photo has not been uploaded from the phone yet.'}
                </p>}
            {p.captured_at && (
              <p className="text-xs text-gray-500 mt-2">
                Taken {formatDateTime(p.captured_at)}
                {p.gps_lat !== null && p.gps_lng !== null && (
                  <> · <a className="underline" target="_blank" rel="noreferrer"
                    href={`https://www.openstreetmap.org/?mlat=${p.gps_lat}&mlon=${p.gps_lng}#map=16/${p.gps_lat}/${p.gps_lng}`}>
                    location</a>{p.gps_accuracy_m ? ` (±${Math.round(Number(p.gps_accuracy_m))} m)` : ''}</>
                )}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Slip details</CardTitle>
          <p className="text-sm text-gray-500">As read from the photo. Fields the agent corrected are marked.</p>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
            {SLIP_FIELDS.map((f) => {
              const conf = p.field_confidence?.[f.key as string]
              return (
                <div key={f.key}>
                  <dt className="text-gray-500 text-xs">{f.label}</dt>
                  <dd className="font-mono">
                    {String(p[f.key] ?? '—')}
                    {editedFields.has(f.key as string) && <span className="ml-1 text-xs text-amber-700 font-sans">edited</span>}
                    {conf !== undefined && conf < 0.9 && (
                      <span className="ml-1 text-xs text-gray-400 font-sans">{Math.round(conf * 100)}%</span>
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
          {one(data.terminal) && (
            <p className="text-xs text-gray-500 mt-4">
              Matched terminal {one(data.terminal)?.tid} ({one(data.terminal)?.bank})
            </p>
          )}
          {!!p.edits.length && (
            <div className="mt-4">
              <div className="text-xs text-gray-500 mb-1">Agent corrections</div>
              <ul className="text-sm space-y-1">
                {p.edits.map((e, i) => (
                  <li key={i}>
                    <span className="font-medium">{e.field}</span>: <span className="font-mono">{e.ocr_value ?? '—'}</span>
                    {' → '}<span className="font-mono">{e.edited_value ?? '—'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.raw_ocr_text && (
            <details className="mt-4">
              <summary className="text-xs text-gray-500 cursor-pointer">Raw text read from the photo</summary>
              <pre className="mt-2 text-xs bg-gray-50 border rounded p-3 whitespace-pre-wrap">{p.raw_ocr_text}</pre>
            </details>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400">
        Created on the phone {p.device_created_at ? formatDateTime(p.device_created_at) : '—'}
        {' · '}synced {p.synced_at ? formatDateTime(p.synced_at) : '—'}
      </p>
    </div>
  )
}
