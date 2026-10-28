'use client'

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils/dates'
import { formatCurrency } from '@/lib/utils/currency'
import { exportToCSV } from '@/lib/utils/csv'
import { Download } from 'lucide-react'
import type { Commission } from '@/lib/types'

interface CommissionTableProps {
  commissions: Commission[]
}

export function CommissionTable({ commissions }: CommissionTableProps) {
  function handleExport() {
    exportToCSV(
      commissions.map((c) => ({
        Agent: c.agent?.full_name ?? '',
        Policy: c.policy?.policy_number ?? '',
        Type: c.commission_type,
        Rate: c.rate,
        Amount_MZN: c.amount,
        Date: formatDate(c.created_at),
      })),
      'commissions'
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>
      {!commissions.length ? (
        <div className="text-center py-12 text-gray-400">No commissions found</div>
      ) : (
        <div className="rounded-lg border bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>Agent</TableHead>
                <TableHead>Policy #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commissions.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.agent?.full_name ?? '—'}</TableCell>
                  <TableCell className="text-sm text-brand">{c.policy?.policy_number ?? '—'}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        c.commission_type === 'direct'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-purple-100 text-purple-800'
                      }
                    >
                      {c.commission_type}
                    </Badge>
                  </TableCell>
                  <TableCell>{c.rate}%</TableCell>
                  <TableCell className="font-medium text-green-700">
                    {formatCurrency(c.amount, c.currency)}
                  </TableCell>
                  <TableCell className="text-sm text-gray-500">{formatDate(c.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
