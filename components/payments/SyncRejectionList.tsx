'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { resolveSyncRejection } from '@/lib/actions/payments'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDateTime } from '@/lib/utils/dates'

export interface SyncRejectionRow {
  id: string
  kind: 'policy' | 'card_payment'
  reason: string
  payload: Record<string, unknown>
  created_at: string
  resolved_at: string | null
  resolution_note: string | null
  agent: { full_name: string } | null
}

/** Sales a phone pushed that the server could not accept. Nothing is lost: the full record is here. */
export function SyncRejectionList({ rows, readOnly = false }: { rows: SyncRejectionRow[]; readOnly?: boolean }) {
  if (!rows.length) return <p className="text-center text-gray-400 py-8">Nothing was refused at sync</p>
  return <div className="space-y-3">{rows.map((r) => <RejectionCard key={r.id} row={r} readOnly={readOnly} />)}</div>
}

function RejectionCard({ row, readOnly }: { row: SyncRejectionRow; readOnly: boolean }) {
  const [note, setNote] = useState('')
  const [isPending, startTransition] = useTransition()
  const p = row.payload
  const fields = (p.fields ?? {}) as Record<string, string | null>
  const amount = row.kind === 'policy' ? p.premium_amount : p.expected_amount

  function resolve() {
    startTransition(async () => {
      const result = await resolveSyncRejection(row.id, note)
      if (result.success) toast.success('Marked as resolved')
      else toast.error(result.error)
    })
  }

  return (
    <Card>
      <CardContent className="pt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3 flex-wrap">
          <div className="font-medium">
            {row.kind === 'policy' ? `Offline policy ${String(p.policy_number ?? '')}` : 'Card payment'}
            {amount != null && <span className="text-gray-500 font-normal"> · {formatCurrency(Number(amount))}</span>}
          </div>
          <div className="text-gray-500">{row.agent?.full_name ?? '—'} · {formatDateTime(row.created_at)}</div>
        </div>
        <p className="text-red-700">{row.reason}</p>
        <p className="text-gray-500">
          {row.kind === 'policy'
            ? `${String(p.client_name ?? '')} · ${String(p.plate_number ?? '')} · issued on the phone ${p.device_issued_at ? formatDateTime(String(p.device_issued_at)) : '—'}`
            : `TID ${fields.tid ?? '—'} · RRN ${fields.rrn ?? '—'} · card •••• ${fields.pan_last4 ?? '—'}`}
        </p>
        <details>
          <summary className="text-xs text-gray-500 cursor-pointer">Full record from the phone</summary>
          <pre className="mt-2 text-xs bg-gray-50 border rounded p-3 overflow-x-auto">{JSON.stringify(p, null, 2)}</pre>
        </details>
        {row.resolved_at ? (
          <p className="text-green-700">Resolved {formatDateTime(row.resolved_at)}: {row.resolution_note}</p>
        ) : !readOnly && (
          <div className="flex gap-2 items-end">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-9"
              placeholder="What was done (e.g. policy re-issued as …, agent refunded)" />
            <Button variant="outline" disabled={isPending || !note.trim()} onClick={resolve}>Resolve</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
