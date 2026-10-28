import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePageRole, STAFF_ROLES } from '@/lib/auth'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { PaymentStatusBadge } from '@/components/shared/PaymentBadges'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDateTime } from '@/lib/utils/dates'
import { cn } from '@/lib/utils'
import { SyncRejectionList, type SyncRejectionRow } from '@/components/payments/SyncRejectionList'
import type { PaymentStatus } from '@/lib/types'

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

const TABS: { key: string; label: string; statuses: PaymentStatus[] }[] = [
  { key: 'review', label: 'To review', statuses: ['NEEDS_REVIEW', 'CONFLICT'] },
  { key: 'awaiting', label: 'Awaiting settlement', statuses: ['PENDING_RECONCILIATION'] },
  { key: 'settled', label: 'Settled', statuses: ['RECONCILED'] },
  { key: 'rejected', label: 'Rejected', statuses: ['FAILED_RECONCILIATION'] },
  { key: 'declined', label: 'Declined at the border', statuses: ['DECLINED'] },
  // not payments: items a phone pushed that the server could not accept
  { key: 'sync', label: 'Not accepted at sync', statuses: [] },
]

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const profile = await requirePageRole(STAFF_ROLES)
  const { tab: tabKey } = await searchParams
  const tab = TABS.find((t) => t.key === tabKey) ?? TABS[0]
  const supabase = await createClient()

  // row-level security limits insurer staff to their own insurer
  const [{ data: payments }, { count: reviewCount }, { data: rejections }, { count: rejectionCount }] = await Promise.all([
    supabase
      .from('policy_payments')
      .select(`id, status, tier, expected_amount, amount, tid, pan_last4, flags, txn_at, created_at, synced_at,
        policy:policies(policy_number), agent:profiles!agent_id(full_name), insurer:insurers(name)`)
      .eq('method', 'POS_CARD_SLIP')
      .in('status', tab.statuses)
      .order('created_at', { ascending: tab.key === 'review' })
      .limit(200),
    supabase.from('policy_payments').select('id', { count: 'exact', head: true })
      .in('status', ['NEEDS_REVIEW', 'CONFLICT']),
    tab.key === 'sync'
      ? supabase.from('sync_rejections').select('*, agent:profiles!agent_id(full_name)')
        .order('resolved_at', { ascending: false, nullsFirst: true })
        .order('created_at', { ascending: false }).limit(200)
      : Promise.resolve({ data: null }),
    supabase.from('sync_rejections').select('id', { count: 'exact', head: true }).is('resolved_at', null),
  ])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Card Payments</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Card slips the phones checked at the border. Flagged slips wait here for a decision; payments
          appear once the phone has synced.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/payments?tab=${t.key}`}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              t.key === tab.key
                ? 'text-brand border-brand'
                : 'text-gray-600 border-transparent hover:text-brand hover:border-brand/60'
            )}
          >
            {t.label}
            {t.key === 'review' && !!reviewCount && (
              <span className="ml-1.5 rounded-full bg-amber-100 text-amber-800 px-1.5 text-xs">{reviewCount}</span>
            )}
            {t.key === 'sync' && !!rejectionCount && (
              <span className="ml-1.5 rounded-full bg-red-100 text-red-800 px-1.5 text-xs">{rejectionCount}</span>
            )}
          </Link>
        ))}
      </div>

      {tab.key === 'sync' ? (
        <SyncRejectionList
          rows={(rejections ?? []).map((r) => ({ ...r, agent: one(r.agent) })) as SyncRejectionRow[]}
          readOnly={profile.role === 'admin'}
        />
      ) : (
      <div className="bg-white rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>Captured</TableHead>
              <TableHead>Policy</TableHead>
              <TableHead>Agent</TableHead>
              {profile.role === 'admin' && <TableHead>Insurer</TableHead>}
              <TableHead>Charged</TableHead>
              <TableHead>Slip</TableHead>
              <TableHead>Card</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!payments?.length ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-gray-400 py-8">
                  {tab.key === 'review' ? 'Nothing to review' : 'No payments'}
                </TableCell>
              </TableRow>
            ) : payments.map((p) => {
              const mismatch = p.amount !== null && Number(p.amount) !== Number(p.expected_amount)
              return (
                <TableRow key={p.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    <Link href={`/payments/${p.id}`} className="text-brand hover:underline">
                      {formatDateTime(p.txn_at ?? p.created_at)}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{one(p.policy)?.policy_number ?? '—'}</TableCell>
                  <TableCell>{one(p.agent)?.full_name ?? '—'}</TableCell>
                  {profile.role === 'admin' && <TableCell className="text-sm">{one(p.insurer)?.name}</TableCell>}
                  <TableCell>{formatCurrency(Number(p.expected_amount))}</TableCell>
                  <TableCell className={mismatch ? 'text-red-600 font-medium' : ''}>
                    {p.amount === null ? '—' : formatCurrency(Number(p.amount))}
                  </TableCell>
                  <TableCell className="text-sm text-gray-500 whitespace-nowrap">
                    {p.pan_last4 ? `•••• ${p.pan_last4}` : '—'}{p.tid ? ` · TID ${p.tid}` : ''}
                  </TableCell>
                  <TableCell className="text-xs text-gray-600 max-w-48">
                    {p.flags?.length ? p.flags.join(', ') : '—'}
                  </TableCell>
                  <TableCell><PaymentStatusBadge status={p.status as PaymentStatus} /></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      )}
    </div>
  )
}
