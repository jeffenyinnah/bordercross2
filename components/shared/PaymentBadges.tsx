import { Badge } from '@/components/ui/badge'
import type { PaymentMethod, PaymentStatus } from '@/lib/types'

const METHOD: Record<PaymentMethod, { label: string; className: string }> = {
  VIRTUAL_CREDIT: { label: 'Credit', className: 'bg-slate-100 text-slate-700 hover:bg-slate-100' },
  POS_CARD_SLIP: { label: 'Card', className: 'bg-sky-100 text-sky-800 hover:bg-sky-100' },
}

export function PaymentMethodBadge({ method }: { method: PaymentMethod }) {
  const m = METHOD[method] ?? METHOD.VIRTUAL_CREDIT
  return <Badge className={m.className}>{m.label}</Badge>
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  NEEDS_REVIEW: 'Needs review',
  CONFLICT: 'Sync conflict',
  PENDING_RECONCILIATION: 'Awaiting settlement',
  RECONCILED: 'Settled',
  FAILED_RECONCILIATION: 'Rejected',
  DECLINED: 'Declined at the border',
}

const STATUS_STYLE: Record<PaymentStatus, string> = {
  NEEDS_REVIEW: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  CONFLICT: 'bg-orange-100 text-orange-800 hover:bg-orange-100',
  PENDING_RECONCILIATION: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
  RECONCILED: 'bg-green-100 text-green-800 hover:bg-green-100',
  FAILED_RECONCILIATION: 'bg-red-100 text-red-800 hover:bg-red-100',
  DECLINED: 'bg-gray-100 text-gray-600 hover:bg-gray-100',
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge className={STATUS_STYLE[status]}>{PAYMENT_STATUS_LABELS[status]}</Badge>
}
