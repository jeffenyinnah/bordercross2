'use client'

import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CurrencyBadge } from '@/components/shared/CurrencyBadge'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { formatDate } from '@/lib/utils/dates'
import { formatCurrency } from '@/lib/utils/currency'
import { Skeleton } from '@/components/ui/skeleton'
import { FileText } from 'lucide-react'
import type { Policy } from '@/lib/types'

interface PolicyTableProps {
  policies: Policy[]
  showAgent?: boolean
}

export function PolicyTable({ policies, showAgent }: PolicyTableProps) {
  if (!policies.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <FileText className="w-12 h-12 mb-3 opacity-30" />
        <p className="font-medium">No policies found</p>
        <p className="text-sm">Try adjusting your filters or create a new policy</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead>Policy #</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Plate</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Currency</TableHead>
            <TableHead>Premium</TableHead>
            {showAgent && <TableHead>Agent</TableHead>}
            <TableHead>Start</TableHead>
            <TableHead>End</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {policies.map((policy) => (
            <TableRow key={policy.id} className="hover:bg-gray-50">
              <TableCell>
                <Link
                  href={`/policies/${policy.id}`}
                  className="font-medium text-brand hover:underline"
                >
                  {policy.policy_number}
                </Link>
              </TableCell>
              <TableCell className="max-w-[150px] truncate">{policy.client_name}</TableCell>
              <TableCell className="font-mono text-sm">{policy.plate_number}</TableCell>
              <TableCell className="capitalize">{policy.policy_type}</TableCell>
              <TableCell>
                <CurrencyBadge currency={policy.currency} />
              </TableCell>
              <TableCell>{formatCurrency(policy.premium_amount, policy.currency)}</TableCell>
              {showAgent && (
                <TableCell className="text-sm text-gray-600">
                  {policy.agent?.full_name ?? '—'}
                </TableCell>
              )}
              <TableCell className="text-sm">{formatDate(policy.start_date)}</TableCell>
              <TableCell className="text-sm">{formatDate(policy.end_date)}</TableCell>
              <TableCell>
                <StatusBadge status={policy.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function PolicyTableSkeleton() {
  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <div className="p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  )
}
